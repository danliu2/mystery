#!/bin/zsh
MYSTERY_ROOT="$(cd -- "$(dirname -- "$0")" && pwd)"
"$MYSTERY_ROOT/mystery.sh"
MYSTERY_EXIT=$?
if [[ $MYSTERY_EXIT -ne 0 ]]; then
  echo "启动失败。按回车关闭此窗口。"
  read -r
fi
exit "$MYSTERY_EXIT"
