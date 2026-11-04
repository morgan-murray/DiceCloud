const fs = require('fs');
db = db.getSiblingDB('dicecloud');
db.createUser({user: 'dicecloud', pwd: fs.readFileSync('/run/secrets/mongo_app_password', 'utf8').trim(), roles: [{role: 'readWrite', db: 'dicecloud'}]});
