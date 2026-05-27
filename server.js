const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 3000;

// 데이터베이스 초기화 (파일 기반 SQLite)
const db = new sqlite3.Database('./heun_gureum.db', (err) => {
    if (err) console.error(err.message);
    console.log('구름이 아지트 DB 연결 완료.');
});

// 테이블 생성
db.serialize(() => {
    // 유저 테이블 (role: 'ADMIN' 또는 'USER')
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spoon_id TEXT UNIQUE,
        nickname TEXT,
        role TEXT
    )`);

    // 게시글 테이블 (type: 'NOTICE', 'FREE', 'REQUEST', 'SECRET', 'CALENDAR')
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        title TEXT,
        content TEXT,
        writer TEXT,
        date TEXT
    )`);

    // 초기 데이터 (테스트용 공지 및 일정)
    db.get("SELECT count(*) as count FROM posts", (err, row) => {
        if (row.count === 0) {
            db.run("INSERT INTO posts (type, title, content, writer, date) VALUES ('NOTICE', '🎉 흔 공지방 및 구름 아지트 오픈!', '구름이들 모두 환영합니다! 여기서 소통해요.', '흔(BJ)', '05-27')");
            db.run("INSERT INTO posts (type, title, content, writer, date) VALUES ('CALENDAR', '가창력 폭발! 구름 노래방 콘테스트 🎤', '금요일 저녁 9시 30분 시작!', '흔(BJ)', '05-29')");
            db.run("INSERT INTO posts (type, title, content, writer, date) VALUES ('FREE', '오늘 스푼 방송 너무 즐거웠어요!', '매일매일 귀호강 하네요 ㅎㅎ', '아기구름', '05-27')");
        }
    });
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'heun_secret_key_cloud_1234',
    resave: false,
    saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, 'public')));

// [API] 현재 세션 정보 가져오기
app.get('/api/session', (req, res) => {
    res.json(req.session.user || null);
});

// [API] 스푼 아이디로 로그인/가입 연동
app.post('/api/login', (req, res) => {
    const { spoon_id, nickname } = req.body;
    if (!spoon_id || !nickname) return res.status(400).send('스푼 ID와 닉네임을 입력해주세요.');

    // ID가 'heun' 이면 관리자(페이지장), 나머지는 일반 구름이(USER)
    const role = (spoon_id.toLowerCase() === 'heun') ? 'ADMIN' : 'USER';

    db.run(`INSERT INTO users (spoon_id, nickname, role) VALUES (?, ?, ?)
            ON CONFLICT(spoon_id) DO UPDATE SET nickname=?`, [spoon_id, nickname, role, nickname], function(err) {
        if (err) return res.status(500).send(err.message);
        
        req.session.user = { spoon_id, nickname, role };
        res.json(req.session.user);
    });
});

// [API] 로그아웃
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.sendStatus(200);
});

// [API] 게시글 목록 조회
app.get('/api/posts/:type', (req, res) => {
    db.all("SELECT * FROM posts WHERE type = ? ORDER BY id DESC", [req.params.type], (err, rows) => {
        if (err) return res.status(500).send(err.message);
        res.json(rows);
    });
});

// [API] 게시글 등록 (권한 체크 포함)
app.post('/api/posts/:type', (req, res) => {
    if (!req.session.user) return res.status(401).send('로그인이 필요합니다.');
    const { type } = req.params;
    const { title, content } = req.body;
    const user = req.session.user;

    // 권한 검증: 공지사항(NOTICE)과 방송달력(CALENDAR)은 페이지장(ADMIN)만 작성 가능
    if ((type === 'NOTICE' || type === 'CALENDAR') && user.role !== 'ADMIN') {
        return res.status(403).send('페이지장(BJ 흔)만 작성 및 수정 권한이 있습니다.');
    }

    const today = new Date();
    const dateStr = `${String(today.getMonth()+1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    db.run("INSERT INTO posts (type, title, content, writer, date) VALUES (?, ?, ?, ?, ?)",
        [type, title, content, user.nickname, dateStr], function(err) {
            if (err) return res.status(500).send(err.message);
            res.sendStatus(200);
        });
});

// [API] 게시글 삭제 (페이지장은 모든 글 삭제 가능, 유저는 본인 글만)
app.delete('/api/posts/:id', (req, res) => {
    if (!req.session.user) return res.status(401).send('로그인이 필요합니다.');
    const user = req.session.user;

    db.get("SELECT * FROM posts WHERE id = ?", [req.params.id], (err, post) => {
        if (!post) return res.status(404).send('글을 찾을 수 없습니다.');
        
        if (user.role === 'ADMIN' || post.writer === user.nickname) {
            db.run("DELETE FROM posts WHERE id = ?", [req.params.id], (err) => {
                if (err) return res.status(500).send(err.message);
                res.sendStatus(200);
            });
        } else {
            res.status(403).send('삭제 권한이 없습니다.');
        }
    });
});

app.listen(PORT, () => {
    console.log(`구름 아지트 서버 가동 중: http://localhost:${PORT}`);
});
