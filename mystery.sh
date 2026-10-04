#!/bin/zsh
set -eu
MYSTERY_ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
cd -- "$MYSTERY_ROOT"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请安装 Node.js 24 LTS 后重试。"
  exit 1
fi
if ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=18)?0:1)'; then
  echo "需要 Node.js 22.18 或更新版本。"
  exit 1
fi
if [[ ! -x "$MYSTERY_ROOT/node_modules/.bin/electron" ]]; then
  echo "依赖未安装。请在本目录执行 npm ci，再双击 mystery.command。"
  exit 1
fi
export MYSTERY_CONFIG_DIR="$MYSTERY_ROOT"
npm run build
exec "$MYSTERY_ROOT/node_modules/.bin/electron" "$MYSTERY_ROOT"
