FROM public.ecr.aws/amazonlinux/amazonlinux:2023

RUN dnf install -y unzip ca-certificates tar gzip jq nodejs npm python3 python3-pip git && dnf clean all

# Install AWS CLI v2
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip && \
    unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscli.zip

# Install Kiro CLI
ENV HOME=/opt/kiro-home
RUN mkdir -p $HOME && curl -fsSL https://cli.kiro.dev/install | bash

# Pre-install common MCP servers
RUN npm install -g exa-mcp-server @modelcontextprotocol/server-filesystem @modelcontextprotocol/server-github 2>/dev/null || true

# Reset HOME for runtime (ECS uses /tmp as writable)
ENV HOME=/tmp
ENV PATH="/opt/kiro-home/.local/bin:${PATH}"
ENV NO_COLOR=1

RUN mkdir -p /output /workspace

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace
ENTRYPOINT ["/entrypoint.sh"]
