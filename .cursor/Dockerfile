# Base image for the Quackback Cloud Agent environment.
#
# Provides the slow, stable system layer: Bun (pinned to the repo's
# packageManager version), Docker Engine + Compose (used to run the local
# datastores from docker-compose.yml), and the userspace overlay tooling that
# lets dockerd run nested inside the Cloud Agent VM. Repo dependencies and
# per-boot services are handled by install.sh / start.sh, not here.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Core tooling + Docker's nested-container prerequisites. fuse-overlayfs lets
# the Docker daemon use a userspace overlay storage driver, which is required
# because the native overlay driver cannot create whiteout device nodes inside
# an unprivileged nested container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        openssl \
        sudo \
        unzip \
        fuse-overlayfs \
        uidmap \
        iptables \
    && update-alternatives --set iptables /usr/sbin/iptables-legacy \
    && update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy \
    && rm -rf /var/lib/apt/lists/*

# Install Docker Engine + CLI + Compose plugin from Docker's official apt repo.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

# Configure the Docker daemon to use the classic image store with the
# fuse-overlayfs storage driver so image builds and container filesystems work
# in the nested VM. dockerd itself is started per-boot by start.sh.
RUN mkdir -p /etc/docker \
    && printf '%s\n' '{"features":{"containerd-snapshotter":false},"storage-driver":"fuse-overlayfs"}' \
        > /etc/docker/daemon.json

# The `ubuntu` user (uid 1000) already exists in the base image. Give it
# passwordless sudo (start.sh needs it to launch dockerd) and Docker access.
RUN usermod -aG docker ubuntu \
    && echo 'ubuntu ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu

# Install Bun, pinned to the version in the repo's package.json "packageManager".
ARG BUN_VERSION=1.3.7
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local/bun bash -s "bun-v${BUN_VERSION}" \
    && ln -s /usr/local/bun/bin/bun /usr/local/bin/bun \
    && ln -s /usr/local/bun/bin/bunx /usr/local/bin/bunx
ENV BUN_INSTALL=/usr/local/bun
ENV PATH=/usr/local/bun/bin:$PATH

USER ubuntu
