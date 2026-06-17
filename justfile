default:
    npm start

start:
    npm start

dev:
    npm run dev

port port:
    PORT={{port}} npm start

check:
    node --check server.js
    node -e 'const fs=require("fs"); for (const file of ["index.html","public/index.html"]) { const html=fs.readFileSync(file,"utf8"); const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]); for (const script of scripts) new Function(script); console.log(`${file}: ${scripts.length}`); }'

docker-build:
    docker compose build

docker-up:
    docker compose up -d --build

docker-down:
    docker compose down

docker-logs:
    docker compose logs -f app

docker-port port:
    APP_PORT={{port}} docker compose up -d --build
