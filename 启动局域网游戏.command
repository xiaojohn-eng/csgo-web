#!/bin/zsh
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node scripts/lan-service.mjs start
if (( $? != 0 )); then
  read -r "?启动失败，按回车关闭。"
fi
