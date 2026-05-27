const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;

// 온라인 멤버 추적을 위한 객체 (1분 이상 반응 없으면 자동 제거)
let onlineUsers = {};

const db = new sqlite3.Database('./heun_gureum.db', (err) => {
    if (err) console.error(err.message);
    console.log('구름이 아지트 확장 DB 연동 완료.');
});

db.serialize(() => {
    // 유저 테이블 (포인트 속성 포함)
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spoon_id TEXT UNIQUE,
        nickname TEXT,
        role TEXT,
        points INTEGER DEFAULT 1000
    )`);

    // 출석체크 기록 테이블
    db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spoon_id TEXT,
        date TEXT,
        UNIQUE(spoon_id, date)
    )`);

    // 주식 계좌 테이블
    db.run(`CREATE TABLE IF NOT EXISTS stock_wallets (
        spoon_id TEXT PRIMARY KEY,
        shares INTEGER DEFAULT 0,
        avg_price INTEGER DEFAULT 0
    )`);

    // 일반 게시판 테이블
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        title TEXT,
        content TEXT,
        writer TEXT,
        date TEXT
    )`);

    // 가상 주식 초기 데이터 정의
    db.run(`CREATE TABLE IF NOT EXISTS stock_market (
        id INTEGER PRIMARY KEY,
        name TEXT,
        current_price INTEGER
    )`);
    
    db.get("SELECT count(*) as count FROM stock_market", (err, row) => {
        if (row.count === 0) {
            db.run("INSERT INTO stock_market (id, name, current_price) VALUES (1, '구름반도체(GURM)', 5000)");
        }
    });
});

// 10분마다 가상 주식 변동 기능 (방송 주식 시뮬레이터 로직)
setInterval(() => {
    db.get("SELECT current_price FROM stock_market WHERE id = 1", (err, row) => {
        if (row) {
            // -15% ~ +15% 범위로 랜덤 변동
            const changePercent = (Math.random() * 30 - 15) / 100;
            let newPrice = Math.round(row.current_price * (1 + changePercent));
            if (newPrice < 500) newPrice = 500; // 상장폐지 방지 하한선
            db.run("UPDATE stock_market SET current_price = ? WHERE id = 1", [newPrice]);
            console.log(`[주가 변동 완료] 구름반도체 현재가: ${newPrice}원`);
        }
    });
}, 10 * 60 * 1000); // 10분 주기

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'heun_secret_key_cloud_1234',
    resave: false,
    saveUninitialized: true
}));
app.use(express.static(path.join(__dirname, 'public')));

// [API] 세션 확인 및 실시간 온라인 갱신
app.get('/api/session', (req, res) => {
    if (req.session.user) {
        const user = req.session.user;
        onlineUsers[user.spoon_id] = { nickname: user.nickname, timestamp: Date.now() };
        
        // 현재 최신 포인트 정보 실시간 DB 동기화
        db.get("SELECT points FROM users WHERE spoon_id = ?", [user.spoon_id], (err, row) => {
            if (row) user.points = row.points;
            res.json(user);
        });
    } else {
        res.json(null);
    }
});

// [API] 실시간 온라인 멤버 리스트 반환
app.get('/api/online-members', (req, res) => {
    const now = Date.now();
    let currentOnline = [];
    for (let id in onlineUsers) {
        if (now - onlineUsers[id].timestamp < 60000) { // 1분 이내 활동한 경우만
            currentOnline.push(onlineUsers[id].nickname);
        } else {
            delete onlineUsers[id];
        }
    }
    res.json(currentOnline);
});

// [API] 스푼 로그인 및 연동
app.post('/api/login', (req, res) => {
    const { spoon_id, nickname } = req.body;
    if (!spoon_id || !nickname) return res.status(400).send('필수 필드 누락');
    const role = (spoon_id.toLowerCase() === 'heun') ? 'ADMIN' : 'USER';

    db.run(`INSERT INTO users (spoon_id, nickname, role, points) VALUES (?, ?, ?, 1000)
            ON CONFLICT(spoon_id) DO UPDATE SET nickname=?`, [spoon_id, nickname, role, nickname], function(err) {
        db.get("SELECT points FROM users WHERE spoon_id = ?", [spoon_id], (err, row) => {
            req.session.user = { spoon_id, nickname, role, points: row.points };
            onlineUsers[spoon_id] = { nickname, timestamp: Date.now() };
            res.json(req.session.user);
        });
    });
});

app.post('/api/logout', (req, res) => {
    if (req.session.user) delete onlineUsers[req.session.user.spoon_id];
    req.session.destroy();
    res.sendStatus(200);
});

// [API] 하루 한 번 출석체크 기능
app.post('/api/attendance', (req, res) => {
    if (!req.session.user) return res.status(401).send('로그인 필요');
    const user = req.session.user;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    db.run("INSERT INTO attendance (spoon_id, date) VALUES (?, ?)", [user.spoon_id, today], function(err) {
        if (err) return res.status(400).send('오늘 이미 출석체크를 완료하셨습니다!');
        
        // 출석 보상 포인트로 500 스푼포인트 지급
        db.run("UPDATE users SET points = points + 500 WHERE spoon_id = ?", [user.spoon_id], () => {
            res.json({ message: '출석 완료! 500포인트가 지급되었습니다.' });
        });
    });
});

// [API] 미니게임: 가위바위보 (판당 100포인트)
app.post('/api/game/rps', (req, res) => {
    if (!req.session.user) return res.status(401).send('로그인 필요');
    const user = req.session.user;
    const { userChoice } = req.body; // 'rock', 'paper', 'scissors'

    db.get("SELECT points FROM users WHERE spoon_id = ?", [user.spoon_id], (err, row) => {
        if (row.points < 100) return res.status(400).send('포인트가 부족합니다! (판당 100P 필요)');

        const choices = ['rock', 'paper', 'scissors'];
        const botChoice = choices[Math.floor(Math.random() * 3)];
        let result = ''; // 'win', 'lose', 'draw'

        if (userChoice === botChoice) result = 'draw';
        else if (
            (userChoice === 'rock' && botChoice === 'scissors') ||
            (userChoice === 'paper' && botChoice === 'rock') ||
            (userChoice === 'scissors' && botChoice === 'paper')
        ) result = 'win';
        else result = 'lose';

        let pointChange = 0;
        if (result === 'win') pointChange = 100;  // 100 획득
        if (result === 'lose') pointChange = -100; // 100 차감

        db.run("UPDATE users SET points = points + ? WHERE spoon_id = ?", [pointChange, user.spoon_id], () => {
            res.json({ result, botChoice, newPoints: row.points + pointChange });
        });
    });
});

// [API] 주식 데이터 상태 조회
app.get('/api/stock/status', (req, res) => {
    db.get("SELECT current_price FROM stock_market WHERE id = 1", (err, market) => {
        if (!req.session.user) return res.json({ market, wallet: { shares: 0, avg_price: 0 } });
        
        db.get("SELECT shares, avg_price FROM stock_wallets WHERE spoon_id = ?", [req.session.user.spoon_id], (err, wallet) => {
            res.json({ market, wallet: wallet || { shares: 0, avg_price: 0 } });
        });
    });
});

// [API] 가상 주식 매수/매도 로직
app.post('/api/stock/trade', (req, res) => {
    if (!req.session.user) return res.status(401).send('로그인 필요');
    const user = req.session.user;
    const { action, amount } = req.body; // action: 'BUY' 또는 'SELL'

    db.get("SELECT current_price FROM stock_market WHERE id = 1", (err, market) => {
        const price = market.current_price;
        const totalCost = price * amount;

        db.get("SELECT points FROM users WHERE spoon_id = ?", [user.spoon_id], (err, userRow) => {
            db.get("SELECT shares, avg_price FROM stock_wallets WHERE spoon_id = ?", [user.spoon_id], (err, walletRow) => {
                const currentWallet = walletRow || { shares: 0, avg_price: 0 };

                if (action === 'BUY') {
                    if (userRow.points < totalCost) return res.status(400).send('보유 포인트가 부족합니다.');
                    
                    const newShares = currentWallet.shares + amount;
                    const newAvg = Math.round(((currentWallet.shares * currentWallet.avg_price) + totalCost) / newShares);

                    db.run("UPDATE users SET points = points - ? WHERE spoon_id = ?", [totalCost, user.spoon_id], () => {
                        db.run(`INSERT INTO stock_wallets (spoon_id, shares, avg_price) VALUES (?, ?, ?)
                                ON CONFLICT(spoon_id) DO UPDATE SET shares=?, avg_price=?`, [user.spoon_id, newShares, newAvg, newShares, newAvg], () => {
                            res.sendStatus(200);
                        });
                    });
                } else if (action === 'SELL') {
                    if (currentWallet.shares < amount) return res.status(400).send('매도 가능한 주식이 부족합니다.');

                    const newShares = currentWallet.shares - amount;
                    db.run("UPDATE users SET points = points + ? WHERE spoon_id = ?", [totalCost, user.spoon_id], () => {
                        db.run("UPDATE stock_wallets SET shares = ? WHERE spoon_id = ?", [newShares, user.spoon_id], () => {
                            res.sendStatus(200);
                        });
                    });
                }
            });
        });
    });
});

// 기본 게시판 라우터 및 삭제 로직
app.get('/api/posts/:type', (req, res) => {
    db.all("SELECT * FROM posts WHERE type = ? ORDER BY id DESC", [req.params.type], (err, rows) => {
        if (err) return res.status(500).send(err.message);
        res.json(rows);
    });
});

app.post('/api/posts/:type', (req, res) => {
    if (!req.session.user) return res.status(401).send('로그인 필요');
    const { type } = req.params; const { title, content } = req.body;
    if ((type === 'NOTICE' || type === 'CALENDAR') && req.session.user.role !== 'ADMIN') return res.status(403).send('권한 없음');
    const today = new Date(); const dateStr = `${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    db.run("INSERT INTO posts (type, title, content, writer, date) VALUES (?, ?, ?, ?, ?)", [type, title, content, req.session.user.nickname, dateStr], () => res.sendStatus(200));
});

app.delete('/api/posts/:id', (req, res) => {
    if (!req.session.user) return res.status(401).send('로그인 필요');
    db.get("SELECT * FROM posts WHERE id = ?", [req.params.id], (err, post) => {
        if (req.session.user.role === 'ADMIN' || post.writer === req.session.user.nickname) {
            db.run("DELETE FROM posts WHERE id = ?", [req.params.id], () => res.sendStatus(200));
        } else { res.status(403).send('권한 없음'); }
    });
});

app.listen(PORT, () => console.log(`통합 아지트 서버 실행 중: http://localhost:${PORT}`));