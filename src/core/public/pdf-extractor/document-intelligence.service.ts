export const loadFile = async (client, file) => {
  const blob = new Blob([file.buffer], { type: file.mimetype });
  const poller = await client.beginAnalyzeDocument('prebuilt-read', await blob.arrayBuffer());
  return poller.pollUntilDone();
};
