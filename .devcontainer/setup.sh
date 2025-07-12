#!/usr/bin/env bash

echo "--- CONFIURING CODESPACE ---"

# configure bun
curl -fsSL https://bun.com/install | bash
bun install

# configure redis
sudo apt-get install redis-tools -y
docker run -p 6379:6379 --name redis -d redis

# configure postgres
sudo apt-get install postgresql-client -y
docker run -p 5432:5432 --name postgres -d postgres
