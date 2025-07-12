#!/usr/bin/env bash

echo "--- CONFIURING CODESPACE ---"

sudo apt-get update -y

# configure bun
curl -fsSL https://bun.com/install | bash
bun install

# configure redis
sudo apt-get install redis-tools -y
docker run -p 6379:6379 --name redis -d redis

# configure postgres
sudo apt-get install postgresql-client -y
docker run -p 5432:5432 -e POSTGRES_PASSWORD=password --name postgres -d postgres
PGPASSWORD=password psql -h localhost -U postgres -c "CREATE DATABASE botholomew;"
PGPASSWORD=password psql -h localhost -U postgres -c "CREATE DATABASE botholomew_test;"
