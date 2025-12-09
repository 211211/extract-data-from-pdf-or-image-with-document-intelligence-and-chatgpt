# Hướng Dẫn Podman - Từ Cơ Bản Đến Nâng Cao

> Tài liệu này giải thích Podman từ gốc, giúp bạn hiểu container technology và cách sử dụng Podman trong dự án.

## Mục Lục

1. [Container là gì?](#1-container-là-gì)
2. [Podman là gì?](#2-podman-là-gì)
3. [So sánh Podman vs Docker](#3-so-sánh-podman-vs-docker)
4. [Cài đặt Podman](#4-cài-đặt-podman)
5. [Kiến trúc Podman](#5-kiến-trúc-podman)
6. [Các lệnh cơ bản](#6-các-lệnh-cơ-bản)
7. [Podman Machine (macOS/Windows)](#7-podman-machine-macoswindows)
8. [Podman Compose](#8-podman-compose)
9. [Volumes và Data Persistence](#9-volumes-và-data-persistence)
10. [Networking](#10-networking)
11. [Best Practices](#11-best-practices)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Container là gì?

### Vấn đề truyền thống

Trước khi có container, việc deploy ứng dụng gặp nhiều vấn đề:

```
Developer: "Code chạy trên máy tôi!"
Ops:       "Nhưng không chạy trên server!"
```

Nguyên nhân:
- Khác version của dependencies (Node.js 18 vs 20)
- Khác hệ điều hành (Ubuntu vs CentOS)
- Khác cấu hình environment variables
- Conflict giữa các ứng dụng cùng chạy trên server

### Container giải quyết vấn đề này

Container là một **đơn vị đóng gói** chứa:
- Code ứng dụng
- Dependencies (libraries, frameworks)
- Runtime (Node.js, Python, Java...)
- Cấu hình hệ thống

```
┌─────────────────────────────────────────────────────────────┐
│                    Container                                 │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Ứng dụng của bạn (NestJS, Express, etc.)           │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  Dependencies (node_modules, pip packages)          │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  Runtime (Node.js 20, Python 3.11)                  │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  OS Libraries (Alpine Linux, Debian slim)           │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Container vs Virtual Machine (VM)

```
┌─────────────────────────────────────────────────────────────┐
│              Virtual Machines                                │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                      │
│  │  App A  │  │  App B  │  │  App C  │                      │
│  ├─────────┤  ├─────────┤  ├─────────┤                      │
│  │Guest OS │  │Guest OS │  │Guest OS │  ← Mỗi VM cần OS     │
│  │ (2GB+)  │  │ (2GB+)  │  │ (2GB+)  │    riêng (~2GB RAM)  │
│  └─────────┘  └─────────┘  └─────────┘                      │
│  ┌─────────────────────────────────────┐                    │
│  │           Hypervisor                │                    │
│  └─────────────────────────────────────┘                    │
│  ┌─────────────────────────────────────┐                    │
│  │           Host OS                   │                    │
│  └─────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Containers                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                      │
│  │  App A  │  │  App B  │  │  App C  │                      │
│  ├─────────┤  ├─────────┤  ├─────────┤                      │
│  │ Bins/   │  │ Bins/   │  │ Bins/   │  ← Chỉ cần libraries │
│  │ Libs    │  │ Libs    │  │ Libs    │    (~50MB)           │
│  └─────────┘  └─────────┘  └─────────┘                      │
│  ┌─────────────────────────────────────┐                    │
│  │      Container Runtime (Podman)     │                    │
│  └─────────────────────────────────────┘                    │
│  ┌─────────────────────────────────────┐                    │
│  │           Host OS                   │                    │
│  └─────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

**Ưu điểm của Container:**
- Nhẹ hơn (~MB vs ~GB)
- Khởi động nhanh (giây vs phút)
- Ít tốn RAM hơn
- Dễ scale hơn

---

## 2. Podman là gì?

### Định nghĩa

**Podman** (Pod Manager) là một container engine **mã nguồn mở**, được phát triển bởi Red Hat. Nó cho phép bạn:

- Tạo và chạy containers
- Quản lý container images
- Chạy pods (nhóm containers)

### Tên gọi "Podman"

```
Pod + Man(ager) = Podman
```

**Pod** là khái niệm từ Kubernetes - một nhóm containers chạy cùng nhau, chia sẻ network và storage.

### Tại sao chọn Podman?

| Lý do | Giải thích |
|-------|-----------|
| **Miễn phí hoàn toàn** | Không giới hạn như Docker Desktop |
| **Không cần daemon** | Chạy trực tiếp, không có process chạy ngầm |
| **Rootless** | Không cần quyền root, bảo mật hơn |
| **Tương thích Docker** | Dùng cùng lệnh, cùng Dockerfile |
| **OCI compliant** | Theo chuẩn Open Container Initiative |

---

## 3. So sánh Podman vs Docker

### Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker                                  │
│                                                              │
│   User ──► docker CLI ──► Docker Daemon ──► Container       │
│                              (dockerd)                       │
│                                 │                            │
│                                 ▼                            │
│                          Chạy ngầm 24/7                      │
│                          Cần quyền root                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      Podman                                  │
│                                                              │
│   User ──► podman CLI ──────────────────► Container         │
│                                                              │
│            Không có daemon!                                  │
│            Fork trực tiếp                                    │
│            Không cần root                                    │
└─────────────────────────────────────────────────────────────┘
```

### Bảng so sánh chi tiết

| Tính năng | Docker | Podman |
|-----------|--------|--------|
| **Giá** | Docker Desktop: $5-24/tháng (doanh nghiệp) | Miễn phí 100% |
| **Daemon** | Cần dockerd chạy ngầm | Không cần (daemonless) |
| **Root** | Mặc định cần root | Mặc định rootless |
| **CLI** | `docker` | `podman` (tương thích 99%) |
| **Compose** | `docker compose` | `podman compose` |
| **Dockerfile** | ✅ Hỗ trợ | ✅ Hỗ trợ |
| **Kubernetes** | Không native | Có thể export YAML |
| **Systemd** | Không tích hợp | Tích hợp native |
| **macOS/Windows** | Docker Desktop | Podman Machine |

### Chuyển từ Docker sang Podman

```bash
# Tạo alias để dùng lệnh docker như cũ
alias docker=podman

# Hoặc
echo 'alias docker=podman' >> ~/.zshrc
source ~/.zshrc

# Sau đó dùng như bình thường
docker run -d nginx
docker ps
docker images
```

---

## 4. Cài đặt Podman

### macOS

```bash
# Cài đặt bằng Homebrew
brew install podman

# Kiểm tra version
podman --version
# Output: podman version 5.x.x
```

### Ubuntu/Debian

```bash
# Cập nhật package list
sudo apt-get update

# Cài đặt Podman
sudo apt-get install -y podman

# Kiểm tra
podman --version
```

### Fedora/RHEL/CentOS

```bash
# Podman được cài sẵn trên Fedora
# Nếu chưa có:
sudo dnf install podman
```

### Windows

```powershell
# Cài đặt bằng winget
winget install RedHat.Podman

# Hoặc tải installer từ:
# https://github.com/containers/podman/releases
```

---

## 5. Kiến trúc Podman

### Các thành phần chính

```
┌─────────────────────────────────────────────────────────────┐
│                    Podman Architecture                       │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   podman CLI                         │    │
│  │            (Giao diện dòng lệnh)                     │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                   libpod                             │    │
│  │       (Thư viện quản lý pods và containers)         │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                   conmon                             │    │
│  │    (Container monitor - giám sát container)         │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │              OCI Runtime (crun/runc)                │    │
│  │         (Thực thi container theo chuẩn OCI)         │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                Linux Kernel                          │    │
│  │     (namespaces, cgroups, seccomp, SELinux)         │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Linux Kernel Features

Container hoạt động dựa trên các tính năng của Linux kernel:

**1. Namespaces (Không gian tên)** - Cô lập tài nguyên
```
┌─────────────────────────────────────────────────────────────┐
│  Namespace        │ Cô lập                                  │
├───────────────────┼─────────────────────────────────────────┤
│  PID              │ Process IDs (container thấy PID riêng)  │
│  Network          │ Network interfaces, IP addresses        │
│  Mount            │ File systems, mount points              │
│  User             │ User và Group IDs                       │
│  UTS              │ Hostname                                │
│  IPC              │ Inter-process communication             │
└─────────────────────────────────────────────────────────────┘
```

**2. Cgroups (Control Groups)** - Giới hạn tài nguyên
```bash
# Ví dụ: Giới hạn container chỉ dùng 512MB RAM và 1 CPU
podman run -d --memory=512m --cpus=1 nginx
```

**3. Seccomp** - Giới hạn system calls
**4. SELinux/AppArmor** - Mandatory Access Control

---

## 6. Các lệnh cơ bản

### Image Commands

```bash
# ═══════════════════════════════════════════════════════════
# IMAGE MANAGEMENT
# ═══════════════════════════════════════════════════════════

# Tìm kiếm image trên registry
podman search nginx

# Tải image về máy
podman pull nginx:alpine
podman pull node:20-alpine

# Liệt kê images đã tải
podman images
# REPOSITORY                TAG         IMAGE ID      CREATED      SIZE
# docker.io/library/nginx   alpine      a2bd1a6d9b0c  2 weeks ago  43.2 MB
# docker.io/library/node    20-alpine   9c6f7d9b6b7a  1 week ago   181 MB

# Xóa image
podman rmi nginx:alpine

# Xóa tất cả images không dùng
podman image prune -a

# Xem chi tiết image
podman inspect nginx:alpine

# Xem lịch sử các layer của image
podman history nginx:alpine
```

### Container Commands

```bash
# ═══════════════════════════════════════════════════════════
# CONTAINER LIFECYCLE
# ═══════════════════════════════════════════════════════════

# Chạy container (foreground)
podman run nginx

# Chạy container (background/detached)
podman run -d nginx

# Chạy với tên cụ thể
podman run -d --name my-nginx nginx

# Chạy với port mapping
podman run -d -p 8080:80 --name web nginx
# Host port 8080 → Container port 80
# Truy cập: http://localhost:8080

# Chạy với environment variables
podman run -d \
  -e DATABASE_URL=postgres://localhost:5432/db \
  -e NODE_ENV=development \
  --name my-app \
  my-image

# Chạy với volume mount
podman run -d \
  -v /path/on/host:/path/in/container \
  --name my-app \
  my-image

# ═══════════════════════════════════════════════════════════
# CONTAINER MANAGEMENT
# ═══════════════════════════════════════════════════════════

# Liệt kê containers đang chạy
podman ps

# Liệt kê tất cả containers (bao gồm đã dừng)
podman ps -a

# Dừng container
podman stop my-nginx

# Khởi động lại container đã dừng
podman start my-nginx

# Restart container
podman restart my-nginx

# Xóa container
podman rm my-nginx

# Xóa container đang chạy (force)
podman rm -f my-nginx

# Xóa tất cả containers đã dừng
podman container prune

# ═══════════════════════════════════════════════════════════
# CONTAINER INTERACTION
# ═══════════════════════════════════════════════════════════

# Xem logs
podman logs my-nginx

# Xem logs real-time (follow)
podman logs -f my-nginx

# Xem 100 dòng logs cuối
podman logs --tail 100 my-nginx

# Thực thi lệnh trong container đang chạy
podman exec my-nginx ls -la /etc/nginx

# Mở shell trong container
podman exec -it my-nginx /bin/sh
# -i: interactive (cho phép input)
# -t: allocate pseudo-TTY (terminal)

# Xem processes trong container
podman top my-nginx

# Xem resource usage (CPU, RAM)
podman stats my-nginx

# Copy file từ host vào container
podman cp ./myfile.txt my-nginx:/tmp/

# Copy file từ container ra host
podman cp my-nginx:/etc/nginx/nginx.conf ./
```

### Build Commands

```bash
# ═══════════════════════════════════════════════════════════
# BUILD IMAGE
# ═══════════════════════════════════════════════════════════

# Build image từ Dockerfile trong thư mục hiện tại
podman build -t my-app:v1 .

# Build với file Dockerfile khác
podman build -t my-app:v1 -f Dockerfile.prod .

# Build với build arguments
podman build \
  --build-arg NODE_VERSION=20 \
  --build-arg ENV=production \
  -t my-app:v1 .

# Build không dùng cache
podman build --no-cache -t my-app:v1 .

# Build multi-platform (cho ARM và AMD64)
podman build --platform linux/amd64,linux/arm64 -t my-app:v1 .
```

---

## 7. Podman Machine (macOS/Windows)

### Tại sao cần Podman Machine?

Container sử dụng các tính năng của **Linux kernel** (namespaces, cgroups). Trên macOS và Windows, không có Linux kernel, nên cần chạy một Linux VM.

```
┌─────────────────────────────────────────────────────────────┐
│                     macOS / Windows                          │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 podman CLI                           │    │
│  └───────────────────────┬─────────────────────────────┘    │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Podman Machine (Linux VM)               │    │
│  │  ┌───────────────────────────────────────────────┐  │    │
│  │  │            Fedora CoreOS / Alpine             │  │    │
│  │  │                                               │  │    │
│  │  │    ┌─────────┐  ┌─────────┐  ┌─────────┐     │  │    │
│  │  │    │Container│  │Container│  │Container│     │  │    │
│  │  │    └─────────┘  └─────────┘  └─────────┘     │  │    │
│  │  │                                               │  │    │
│  │  └───────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│              Hypervisor (QEMU / Apple Virtualization)        │
└─────────────────────────────────────────────────────────────┘
```

### Các lệnh Podman Machine

```bash
# ═══════════════════════════════════════════════════════════
# PODMAN MACHINE MANAGEMENT
# ═══════════════════════════════════════════════════════════

# Khởi tạo machine mới (chỉ cần chạy 1 lần)
podman machine init

# Khởi tạo với cấu hình tùy chỉnh
podman machine init \
  --cpus 4 \           # 4 CPU cores
  --memory 8192 \      # 8GB RAM
  --disk-size 50       # 50GB disk

# Liệt kê machines
podman machine list
# NAME                     VM TYPE     CREATED        LAST UP         CPUS  MEMORY   DISK SIZE
# podman-machine-default*  qemu        2 hours ago    Currently running  4    8GiB     50GiB

# Khởi động machine
podman machine start

# Dừng machine
podman machine stop

# SSH vào machine (để debug)
podman machine ssh

# Xóa machine
podman machine rm

# Xem thông tin machine
podman machine inspect

# Reset machine về mặc định
podman machine rm
podman machine init
podman machine start
```

### Cấu hình khuyến nghị

```bash
# Cho development thông thường
podman machine init --cpus 2 --memory 4096 --disk-size 30

# Cho chạy nhiều containers (microservices)
podman machine init --cpus 4 --memory 8192 --disk-size 50

# Cho ML/AI workloads
podman machine init --cpus 8 --memory 16384 --disk-size 100
```

---

## 8. Podman Compose

### Compose là gì?

Compose cho phép định nghĩa và chạy **nhiều containers** cùng lúc bằng file YAML.

```
┌─────────────────────────────────────────────────────────────┐
│                    Không dùng Compose                        │
│                                                              │
│  # Phải chạy từng lệnh một                                  │
│  podman run -d --name redis redis:alpine                    │
│  podman run -d --name postgres postgres:15                  │
│  podman run -d --name app --link redis --link postgres app  │
│                                                              │
│  # Khó quản lý, dễ sai thứ tự, khó maintain                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Dùng Compose                              │
│                                                              │
│  # Chỉ cần 1 lệnh                                           │
│  podman compose up -d                                       │
│                                                              │
│  # Tất cả được định nghĩa trong docker-compose.yml          │
└─────────────────────────────────────────────────────────────┘
```

### Cấu trúc docker-compose.yml

```yaml
# docker-compose.yml

# Version của compose file format (optional từ v2+)
version: '3.8'

# Định nghĩa các services (containers)
services:
  # Service 1: Web application
  app:
    build:
      context: .                    # Thư mục chứa Dockerfile
      dockerfile: Dockerfile        # Tên file Dockerfile
    ports:
      - "8080:3000"                 # host:container
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgres://postgres:5432/mydb
    volumes:
      - ./src:/app/src              # Mount source code
    depends_on:
      - postgres                    # Chờ postgres start trước
      - redis

  # Service 2: Database
  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=admin
      - POSTGRES_PASSWORD=secret
      - POSTGRES_DB=mydb
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  # Service 3: Cache
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

# Định nghĩa volumes (persistent storage)
volumes:
  postgres-data:        # Tên volume
    name: my-app-postgres-data
  redis-data:
    name: my-app-redis-data

# Định nghĩa networks (optional)
networks:
  default:
    name: my-app-network
```

### Các lệnh Compose

```bash
# ═══════════════════════════════════════════════════════════
# COMPOSE COMMANDS
# ═══════════════════════════════════════════════════════════

# Khởi động tất cả services
podman compose up

# Khởi động ở background
podman compose up -d

# Khởi động và rebuild images
podman compose up -d --build

# Dừng tất cả services
podman compose down

# Dừng và xóa volumes
podman compose down -v

# Xem logs
podman compose logs

# Xem logs của service cụ thể
podman compose logs app

# Follow logs
podman compose logs -f app

# Xem status
podman compose ps

# Restart service
podman compose restart app

# Scale service (chạy nhiều instances)
podman compose up -d --scale app=3

# Thực thi lệnh trong service
podman compose exec app /bin/sh

# Pull images mới nhất
podman compose pull
```

### Profiles (Chạy có điều kiện)

```yaml
# docker-compose.yml
services:
  app:
    image: my-app
    # Luôn chạy (không có profile)

  nginx:
    image: nginx
    profiles:
      - scaled        # Chỉ chạy khi dùng profile 'scaled'

  prometheus:
    image: prom/prometheus
    profiles:
      - monitoring    # Chỉ chạy khi dùng profile 'monitoring'
```

```bash
# Chạy services mặc định
podman compose up -d

# Chạy với profile 'scaled'
podman compose --profile scaled up -d

# Chạy với nhiều profiles
podman compose --profile scaled --profile monitoring up -d
```

---

## 9. Volumes và Data Persistence

### Vấn đề: Data mất khi container bị xóa

```bash
# Tạo container, ghi data
podman run -d --name mydb postgres
# ... ghi data vào database ...

# Xóa container
podman rm -f mydb

# Data đã mất hoàn toàn! 😱
```

### Giải pháp: Volumes

```
┌─────────────────────────────────────────────────────────────┐
│                      Host Machine                            │
│                                                              │
│  ┌─────────────────┐                                        │
│  │ Volume:         │                                        │
│  │ postgres-data   │◄────────────────────┐                  │
│  │ /var/lib/...    │                     │                  │
│  └─────────────────┘                     │                  │
│                                          │                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                Container                             │    │
│  │                                                      │    │
│  │    /var/lib/postgresql/data ─────────┘              │    │
│  │    (Mount point)                                    │    │
│  │                                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Container bị xóa → Volume vẫn còn → Data được bảo toàn    │
└─────────────────────────────────────────────────────────────┘
```

### Các loại Volumes

```bash
# ═══════════════════════════════════════════════════════════
# 1. NAMED VOLUME (Khuyến nghị)
# ═══════════════════════════════════════════════════════════
# Podman quản lý vị trí lưu trữ

podman volume create mydata
podman run -d -v mydata:/app/data my-image

# Trong docker-compose.yml:
volumes:
  mydata:
    name: my-app-data

# ═══════════════════════════════════════════════════════════
# 2. BIND MOUNT (Mount thư mục từ host)
# ═══════════════════════════════════════════════════════════
# Dùng cho development, mount source code

podman run -d -v /path/on/host:/path/in/container my-image

# Ví dụ: Mount source code để hot reload
podman run -d \
  -v $(pwd)/src:/app/src \
  -v $(pwd)/package.json:/app/package.json \
  my-node-app

# ═══════════════════════════════════════════════════════════
# 3. TMPFS (Memory-based, không persistent)
# ═══════════════════════════════════════════════════════════
# Dùng cho data tạm thời, cần tốc độ cao

podman run -d --tmpfs /tmp my-image
```

### Quản lý Volumes

```bash
# Tạo volume
podman volume create mydata

# Liệt kê volumes
podman volume ls

# Xem chi tiết volume
podman volume inspect mydata

# Xóa volume
podman volume rm mydata

# Xóa tất cả volumes không dùng
podman volume prune

# Backup volume
podman run --rm \
  -v mydata:/source:ro \
  -v $(pwd):/backup \
  alpine tar cvf /backup/mydata-backup.tar /source

# Restore volume
podman run --rm \
  -v mydata:/target \
  -v $(pwd):/backup \
  alpine tar xvf /backup/mydata-backup.tar -C /target --strip 1
```

---

## 10. Networking

### Mặc định: Bridge Network

```
┌─────────────────────────────────────────────────────────────┐
│                    Podman Networking                         │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Bridge Network (podman0)                │    │
│  │                   10.88.0.0/16                       │    │
│  │                                                      │    │
│  │   ┌─────────┐   ┌─────────┐   ┌─────────┐          │    │
│  │   │ nginx   │   │  app    │   │  redis  │          │    │
│  │   │10.88.0.2│   │10.88.0.3│   │10.88.0.4│          │    │
│  │   └────┬────┘   └────┬────┘   └────┬────┘          │    │
│  │        │             │             │                │    │
│  │        └─────────────┼─────────────┘                │    │
│  │                      │                              │    │
│  └──────────────────────┼──────────────────────────────┘    │
│                         │                                    │
│                    Port Mapping                              │
│                    -p 8080:80                                │
│                         │                                    │
│                         ▼                                    │
│                   Host: 0.0.0.0:8080                        │
└─────────────────────────────────────────────────────────────┘
```

### Port Mapping

```bash
# Map port đơn giản
podman run -d -p 8080:80 nginx
# Truy cập: http://localhost:8080

# Map nhiều ports
podman run -d \
  -p 8080:80 \
  -p 8443:443 \
  nginx

# Map port range
podman run -d -p 8080-8090:80-90 my-app

# Map tất cả exposed ports (random host ports)
podman run -d -P nginx

# Chỉ bind localhost (không expose ra network)
podman run -d -p 127.0.0.1:8080:80 nginx
```

### Custom Networks

```bash
# Tạo network
podman network create my-network

# Chạy containers trong cùng network
podman run -d --name app --network my-network my-app
podman run -d --name db --network my-network postgres

# Containers có thể gọi nhau bằng tên
# Từ 'app' container:
#   curl http://db:5432  ← Dùng tên container

# Trong docker-compose.yml
networks:
  frontend:
    name: my-frontend-network
  backend:
    name: my-backend-network

services:
  nginx:
    networks:
      - frontend
  app:
    networks:
      - frontend
      - backend
  db:
    networks:
      - backend
```

### DNS Resolution

```yaml
# docker-compose.yml
services:
  app:
    image: my-app
    # Có thể gọi 'redis' và 'postgres' bằng tên
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgres://postgres:5432/db

  redis:
    image: redis

  postgres:
    image: postgres
```

---

## 11. Best Practices

### Dockerfile Best Practices

```dockerfile
# ═══════════════════════════════════════════════════════════
# 1. SỬ DỤNG MULTI-STAGE BUILDS
# ═══════════════════════════════════════════════════════════

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Stage 2: Production (image nhỏ hơn)
FROM node:20-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/main.js"]

# ═══════════════════════════════════════════════════════════
# 2. THỨ TỰ LAYERS (Ít thay đổi → Nhiều thay đổi)
# ═══════════════════════════════════════════════════════════

# ❌ Sai: COPY . . trước khi install dependencies
FROM node:20-alpine
WORKDIR /app
COPY . .                    # Thay đổi code → rebuild npm install
RUN npm install
CMD ["npm", "start"]

# ✅ Đúng: Install dependencies trước
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./       # Chỉ copy package.json trước
RUN npm ci                  # Cache layer này
COPY . .                    # Copy code sau
CMD ["npm", "start"]

# ═══════════════════════════════════════════════════════════
# 3. SỬ DỤNG .dockerignore
# ═══════════════════════════════════════════════════════════

# .dockerignore
node_modules
.git
.env
*.log
dist
coverage

# ═══════════════════════════════════════════════════════════
# 4. KHÔNG CHẠY VỚI ROOT
# ═══════════════════════════════════════════════════════════

FROM node:20-alpine
WORKDIR /app

# Tạo non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY --chown=nestjs:nodejs . .

# Chuyển sang non-root user
USER nestjs

CMD ["node", "dist/main.js"]
```

### Security Best Practices

```bash
# ═══════════════════════════════════════════════════════════
# 1. CHẠY ROOTLESS (Mặc định với Podman)
# ═══════════════════════════════════════════════════════════

# Podman mặc định chạy rootless
podman run -d nginx

# Kiểm tra user đang chạy
podman top <container> user

# ═══════════════════════════════════════════════════════════
# 2. GIỚI HẠN RESOURCES
# ═══════════════════════════════════════════════════════════

podman run -d \
  --memory=512m \           # Giới hạn RAM
  --cpus=1 \                # Giới hạn CPU
  --pids-limit=100 \        # Giới hạn số processes
  nginx

# ═══════════════════════════════════════════════════════════
# 3. READ-ONLY FILESYSTEM
# ═══════════════════════════════════════════════════════════

podman run -d \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /var/cache/nginx \
  nginx

# ═══════════════════════════════════════════════════════════
# 4. KHÔNG DÙNG --privileged
# ═══════════════════════════════════════════════════════════

# ❌ Nguy hiểm: Full access đến host
podman run --privileged dangerous-image

# ✅ Chỉ cấp quyền cần thiết
podman run --cap-add=NET_ADMIN my-network-tool

# ═══════════════════════════════════════════════════════════
# 5. SCAN IMAGES CHO VULNERABILITIES
# ═══════════════════════════════════════════════════════════

# Sử dụng Trivy (tool scan vulnerabilities)
brew install trivy
trivy image my-app:latest
```

### Production Best Practices

```yaml
# docker-compose.yml cho Production
services:
  app:
    image: my-app:${VERSION:-latest}
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 256M
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

---

## 12. Troubleshooting

### Lỗi thường gặp và cách khắc phục

#### 1. "Cannot connect to Podman" (macOS/Windows)

```bash
# Nguyên nhân: Podman machine chưa chạy

# Kiểm tra status
podman machine list

# Start machine
podman machine start

# Nếu vẫn lỗi, reset machine
podman machine rm
podman machine init --cpus 4 --memory 8192
podman machine start
```

#### 2. "Port already in use"

```bash
# Kiểm tra process đang dùng port
lsof -i :8080

# Kill process đó hoặc dùng port khác
podman run -d -p 8081:80 nginx
```

#### 3. "No space left on device"

```bash
# Kiểm tra disk usage
podman system df

# Dọn dẹp
podman system prune -a --volumes

# Trên macOS, có thể cần tăng disk size cho machine
podman machine rm
podman machine init --disk-size 100
podman machine start
```

#### 4. "Image not found"

```bash
# Kiểm tra tên image đúng chưa
podman search nginx

# Pull image với full path
podman pull docker.io/library/nginx:alpine

# Hoặc từ registry khác
podman pull quay.io/nginx/nginx:latest
```

#### 5. "Permission denied"

```bash
# Khi mount volume
# Nguyên nhân: SELinux hoặc permission mismatch

# Thêm :Z hoặc :z flag
podman run -v /host/path:/container/path:Z my-image

# Hoặc chown trong Dockerfile
RUN chown -R 1000:1000 /app
```

#### 6. Container exits immediately

```bash
# Xem logs
podman logs <container-id>

# Chạy interactively để debug
podman run -it my-image /bin/sh

# Kiểm tra exit code
podman inspect <container-id> --format='{{.State.ExitCode}}'
```

### Debug Commands

```bash
# Xem tất cả thông tin container
podman inspect <container>

# Xem events real-time
podman events

# Xem system info
podman info

# Xem resource usage
podman stats

# Xem network details
podman network inspect <network>

# SSH vào Podman machine (macOS/Windows)
podman machine ssh
```

---

## Tổng kết

### Workflow cơ bản

```bash
# 1. Khởi động Podman (macOS/Windows)
podman machine start

# 2. Clone project
git clone <repo>
cd <project>

# 3. Khởi động services
podman compose up -d

# 4. Xem logs
podman compose logs -f

# 5. Dừng khi xong
podman compose down
```

### Lệnh hay dùng nhất

```bash
podman ps                    # Xem containers đang chạy
podman logs -f <name>        # Theo dõi logs
podman exec -it <name> sh    # Vào shell container
podman compose up -d         # Khởi động services
podman compose down          # Dừng services
podman system prune -a       # Dọn dẹp
```

### Resources

- [Podman Official Docs](https://docs.podman.io/)
- [Podman Compose](https://github.com/containers/podman-compose)
- [Container Security](https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html)

---

*Tài liệu này được tạo cho dự án LLM Agent. Cập nhật lần cuối: 2025-12-09*
