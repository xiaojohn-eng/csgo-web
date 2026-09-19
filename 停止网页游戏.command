#!/bin/zsh
cd -- "${0:A:h}"
exec node scripts/lan-service.mjs stop
