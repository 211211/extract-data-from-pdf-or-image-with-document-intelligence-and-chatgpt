# Backup and Recovery Guide

## Overview

This document outlines backup and recovery procedures for Azure CosmosDB (chat storage) and Azure AI Search (vector/semantic search). Both services have built-in mechanisms for data protection.

## Azure CosmosDB

### Built-in Backup Types

| Backup Type | Description | RPO | RTO | Cost |
|-------------|-------------|-----|-----|------|
| **Periodic Backup** | Default, automatic every 4 hours | 4 hours | Hours | Included |
| **Continuous Backup** | Point-in-time restore (PITR) | ~0 (seconds) | Minutes | Premium |

### 1. Periodic Backup (Default)

CosmosDB automatically backs up data every 4 hours and retains backups for 8 hours by default.

**Configuration (Azure Portal):**
1. Navigate to CosmosDB account → Settings → Backup Policy
2. Configure:
   - Backup interval: 1-24 hours (default: 4)
   - Backup retention: 8 hours to 720 hours (30 days)
   - Backup storage redundancy: LRS/GRS/ZRS

**Limitations:**
- Cannot self-restore from periodic backups
- Must contact Azure Support for restoration
- Minimum RPO: 4 hours

### 2. Continuous Backup (Recommended for Production)

Enables self-service point-in-time restore to any point within the retention period.

**Enable via Azure CLI:**
```bash
# Enable continuous backup on new account
az cosmosdb create \
  --name chatdb-cosmos \
  --resource-group chat-rg \
  --backup-policy-type Continuous \
  --continuous-tier Continuous7Days

# Or upgrade existing account
az cosmosdb update \
  --name chatdb-cosmos \
  --resource-group chat-rg \
  --backup-policy-type Continuous
```

**Point-in-Time Restore:**
```bash
# Restore to a specific point in time
az cosmosdb restore \
  --target-database-account-name chatdb-restored \
  --resource-group chat-rg \
  --source-database-account-name chatdb-cosmos \
  --restore-timestamp "2024-01-15T10:30:00Z" \
  --location "East US"
```

**Retention Tiers:**
- `Continuous7Days`: 7-day retention (lower cost)
- `Continuous30Days`: 30-day retention (higher cost)

### 3. Export Data (Application-Level Backup)

For additional backup flexibility, export data programmatically:

```typescript
// Export all threads for a user
async function exportUserData(userId: string): Promise<ExportData> {
  const threads = await chatRepository.listThreads({ userId, limit: 1000 });
  const data: ExportData = { threads: [], messages: [] };

  for (const thread of threads.items) {
    data.threads.push(thread);
    const messages = await chatRepository.getMessages(thread.id, { limit: 1000 });
    data.messages.push(...messages.items);
  }

  return data;
}

// Save to Azure Blob Storage
async function backupToBlob(data: ExportData, filename: string): Promise<void> {
  const blobClient = containerClient.getBlockBlobClient(filename);
  await blobClient.upload(JSON.stringify(data), JSON.stringify(data).length);
}
```

### Recovery Procedures

**Scenario 1: Accidental Delete (with Soft Delete)**
```typescript
// Threads use soft delete by default
await chatService.restoreThread(threadId);
```

**Scenario 2: Point-in-Time Restore (Continuous Backup)**
```bash
# 1. Restore to new account
az cosmosdb restore \
  --target-database-account-name chatdb-restored \
  --source-database-account-name chatdb-cosmos \
  --restore-timestamp "2024-01-15T10:30:00Z"

# 2. Verify restored data
# 3. Update application connection string
# 4. Migrate from restored account if needed
```

**Scenario 3: Full Disaster Recovery**
1. Contact Azure Support for periodic backup restore
2. Or restore from continuous backup to new region
3. Update DNS/connection strings
4. Verify data integrity

---

## Azure AI Search

### Built-in Data Protection

Azure AI Search does NOT have built-in backup/restore. Data protection strategies:

| Strategy | Complexity | Cost | Recovery Time |
|----------|------------|------|---------------|
| **Reindex from Source** | Low | Low | Hours |
| **Replica Regions** | Medium | High | Minutes |
| **Index Snapshot Export** | High | Medium | Hours |

### 1. Reindex from Source (Primary Strategy)

Since search indexes are derived from source documents, the primary backup strategy is maintaining the ability to rebuild indexes.

**Prerequisites:**
- Store all documents in persistent storage (Blob, CosmosDB)
- Keep indexing scripts/configuration in source control
- Document field mappings and analyzers

**Recovery Process:**
```bash
# 1. Create new index with same schema
node scripts/create-index.ts

# 2. Reindex from source documents
node scripts/reindex-from-cosmos.ts

# 3. Verify index integrity
curl "$AZURE_SEARCH_ENDPOINT/indexes/documents/stats?api-version=2023-11-01" \
  -H "api-key: $AZURE_SEARCH_KEY"
```

**Reindexing Script Example:**
```typescript
// scripts/reindex-from-cosmos.ts
import { SearchClient } from '@azure/search-documents';
import { CosmosClient } from '@azure/cosmos';

async function reindexFromCosmos(): Promise<void> {
  const cosmosClient = new CosmosClient(process.env.COSMOS_CONNECTION_STRING!);
  const searchClient = new SearchClient(
    process.env.AZURE_SEARCH_ENDPOINT!,
    'documents',
    new AzureKeyCredential(process.env.AZURE_SEARCH_KEY!)
  );

  const container = cosmosClient.database('chatdb').container('documents');
  const { resources: documents } = await container.items.readAll().fetchAll();

  // Batch upload in chunks of 1000
  const batchSize = 1000;
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    await searchClient.uploadDocuments(batch);
    console.log(`Indexed ${Math.min(i + batchSize, documents.length)}/${documents.length}`);
  }
}
```

### 2. Replica Regions (High Availability)

For mission-critical search, deploy replicas across regions:

```bash
# Create search service with replicas
az search service create \
  --name chat-search \
  --resource-group chat-rg \
  --sku standard2 \
  --replica-count 2 \
  --partition-count 1

# Note: Replicas are within same region
# For cross-region, create separate search services
```

**Cross-Region Strategy:**
1. Primary search service in Region A
2. Secondary search service in Region B
3. Index updates sync to both services
4. Traffic Manager routes to healthy region

### 3. Index Snapshot Export

Export index data for offline backup:

```typescript
// Export index to JSON files
async function exportIndex(indexName: string): Promise<void> {
  const searchClient = new SearchClient(endpoint, indexName, credential);

  let continuationToken: string | undefined;
  let pageNumber = 0;

  do {
    const results = await searchClient.search('*', {
      top: 1000,
      skip: pageNumber * 1000,
      includeTotalCount: true,
    });

    const documents: any[] = [];
    for await (const result of results.results) {
      documents.push(result.document);
    }

    // Save to blob storage
    await saveToBlob(`index-${indexName}-page-${pageNumber}.json`, documents);

    pageNumber++;
  } while (documents.length === 1000);
}
```

### Index Rebuild Procedure

**Step 1: Verify Index Schema**
```bash
# Export current schema
curl "$AZURE_SEARCH_ENDPOINT/indexes/documents?api-version=2023-11-01" \
  -H "api-key: $AZURE_SEARCH_KEY" > index-schema.json
```

**Step 2: Delete and Recreate Index**
```bash
# Delete corrupted index
curl -X DELETE \
  "$AZURE_SEARCH_ENDPOINT/indexes/documents?api-version=2023-11-01" \
  -H "api-key: $AZURE_SEARCH_KEY"

# Create fresh index
curl -X PUT \
  "$AZURE_SEARCH_ENDPOINT/indexes/documents?api-version=2023-11-01" \
  -H "api-key: $AZURE_SEARCH_KEY" \
  -H "Content-Type: application/json" \
  -d @index-schema.json
```

**Step 3: Reindex Documents**
```bash
yarn seed  # Uses existing seed script
```

---

## Disaster Recovery Matrix

| Scenario | CosmosDB Recovery | AI Search Recovery |
|----------|------------------|-------------------|
| Accidental document delete | Soft delete restore | Reindex single document |
| Index corruption | N/A | Recreate and reindex |
| Regional outage | Failover to replica | Failover to replica region |
| Full account loss | PITR from continuous backup | Reindex from CosmosDB |
| Ransomware | PITR to before attack | Reindex after CosmosDB restore |

## Monitoring & Alerts

### CosmosDB Alerts

```bash
# Create alert for backup failure
az monitor metrics alert create \
  --name "CosmosDB-Backup-Failed" \
  --resource-group chat-rg \
  --scopes "/subscriptions/{sub}/resourceGroups/chat-rg/providers/Microsoft.DocumentDB/databaseAccounts/chatdb-cosmos" \
  --condition "avg DataUsage > 90" \
  --action /subscriptions/{sub}/resourceGroups/chat-rg/providers/microsoft.insights/actionGroups/ops-team
```

### AI Search Alerts

```bash
# Monitor search latency and availability
az monitor metrics alert create \
  --name "Search-High-Latency" \
  --resource-group chat-rg \
  --scopes "/subscriptions/{sub}/resourceGroups/chat-rg/providers/Microsoft.Search/searchServices/chat-search" \
  --condition "avg SearchLatency > 1000" \
  --action /subscriptions/{sub}/resourceGroups/chat-rg/providers/microsoft.insights/actionGroups/ops-team
```

## Backup Schedule Recommendations

| Environment | CosmosDB Backup | AI Search Backup | Retention |
|-------------|-----------------|------------------|-----------|
| Development | Periodic (4hr) | None (reindex) | 8 hours |
| Staging | Periodic (4hr) | Weekly export | 7 days |
| Production | Continuous 30d | Daily export | 30 days |

## Runbook: Emergency Recovery

### Step 1: Assess Impact
- [ ] Identify affected data/services
- [ ] Determine last known good state
- [ ] Notify stakeholders

### Step 2: CosmosDB Recovery
- [ ] If using continuous backup: PITR to new account
- [ ] If using periodic backup: Contact Azure Support
- [ ] Verify restored data integrity

### Step 3: AI Search Recovery
- [ ] If index intact: No action needed
- [ ] If index corrupted: Recreate and reindex from CosmosDB
- [ ] Verify search results accuracy

### Step 4: Application Recovery
- [ ] Update connection strings if needed
- [ ] Deploy application changes
- [ ] Run smoke tests
- [ ] Monitor for errors

### Step 5: Post-Incident
- [ ] Document root cause
- [ ] Update runbook if needed
- [ ] Review backup strategy

## References

- [CosmosDB Backup and Restore](https://docs.microsoft.com/azure/cosmos-db/continuous-backup-restore-introduction)
- [AI Search Index Rebuild](https://docs.microsoft.com/azure/search/search-howto-reindex)
- [Azure Disaster Recovery Best Practices](https://docs.microsoft.com/azure/architecture/framework/resiliency/backup-and-recovery)
