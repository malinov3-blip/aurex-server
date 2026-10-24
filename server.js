const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uigfryghaqyekhzwgxgx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'ТВОЙ_SERVICE_ROLE_KEY_СЮДА';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'aurex_secret_2024';

// --- РЕГИСТРАЦИЯ ---
app.post('/api/register', async (req, res) => {
    const { email, phone, password } = req.body;
    
    // Проверка: есть ли уже такой пользователь
    const { data: existing } = await supabase.from('users').select('email').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Эта почта уже зарегистрирована' });

    // Сохраняем в базу (пароль в открытом виде для демо)
    const { error } = await supabase.from('users').insert({ email, phone, password, balance: 0, btc_balance: 0 });
    if (error) return res.status(400).json({ error: error.message });
    
    res.json({ success: true });
});

// --- ВХОД ---
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('email', email).eq('password', password).maybeSingle();
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
    
    const token = jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, JWT_SECRET);
    res.json({ token, user: { email: user.email, balance: user.balance, is_admin: user.is_admin } });
});

// --- ПОЛУЧИТЬ ДАННЫЕ ---
app.get('/api/me', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { data: user } = await supabase.from('users').select('*').eq('email', decoded.email).single();
        res.json(user);
    } catch (e) { res.status(401).json({ error: 'Ошибка' }); }
});

// --- СТАКАН ---
app.get('/api/orderbook/:pair', async (req, res) => {
    const { data } = await supabase.from('order_book').select('*').eq('pair', req.params.pair).eq('status', 'open');
    res.json(data || []);
});

app.post('/api/order', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { pair, side, price, amount } = req.body;
        const { data: user } = await supabase.from('users').select('*').eq('email', decoded.email).single();

        if (side === 'buy') {
            const totalCost = price * amount;
            if (user.balance < totalCost) return res.status(400).json({ error: 'Недостаточно USDT' });
            await supabase.from('users').update({ balance: user.balance - totalCost }).eq('email', decoded.email);
        } else {
            const coinField = pair.replace('USDT', '').toLowerCase() + '_balance';
            if ((user[coinField] || 0) < amount) return res.status(400).json({ error: 'Недостаточно монет' });
            await supabase.from('users').update({ [coinField]: (user[coinField] || 0) - amount }).eq('email', decoded.email);
        }

        await supabase.from('order_book').insert({ pair, side, price, amount, user_email: decoded.email, status: 'open' });
        res.json({ success: true });
    } catch (e) { res.status(401).json({ error: 'Ошибка' }); }
});

// --- P2P ---
app.get('/api/p2p', async (req, res) => {
    const { data } = await supabase.from('p2p_offers').select('*').order('created_at', { ascending: false });
    res.json(data || []);
});
app.post('/api/p2p', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        await supabase.from('p2p_offers').insert({ seller_email: decoded.email, asset: req.body.asset, price: req.body.price, amount: req.body.amount });
        res.json({ success: true });
    } catch (e) { res.status(401).json({ error: 'Ошибка' }); }
});

// --- ЧАТ ---
app.get('/api/chat', async (req, res) => {
    const { data } = await supabase.from('chat_messages').select('*').order('created_at', { ascending: true }).limit(100);
    res.json(data || []);
});
app.post('/api/chat', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        await supabase.from('chat_messages').insert({ author_email: decoded.email, message: req.body.message });
        res.json({ success: true });
    } catch (e) { res.status(401).json({ error: 'Ошибка' }); }
});

// --- ЛИЧНЫЕ СООБЩЕНИЯ (ПОДДЕРЖКА) ---
app.get('/api/messages/:user1/:user2', async (req, res) => {
    const { user1, user2 } = req.params;
    const { data } = await supabase.from('direct_messages').select('*').or(`and(sender_email.eq.${user1},receiver_email.eq.${user2}),and(sender_email.eq.${user2},receiver_email.eq.${user1})`).order('created_at', { ascending: true });
    res.json(data || []);
});
app.post('/api/messages', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        await supabase.from('direct_messages').insert({ sender_email: decoded.email, receiver_email: req.body.receiver_email, message: req.body.message });
        res.json({ success: true });
    } catch (e) { res.status(401).json({ error: 'Ошибка' }); }
});

// --- ПОСТЫ СООБЩЕСТВА ---
app.get('/api/posts', async (req, res) => {
    const { data } = await supabase.from('community_posts').select('*').order('created_at', { ascending: false });
    res.json(data || []);
});
app.post('/api/posts', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        await supabase.from('community_posts').insert({ author_email: decoded.email, title: req.body.title, content: req.body.content });
        res.json({ success: true });
    } catch (e) { res.status(401).json({ error: 'Ошибка' }); }
});

// --- ПОДДЕРЖКА ---
app.post('/api/support', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        await supabase.from('support_tickets').insert({ email: decoded.email, message: req.body.message, status: 'open' });
        res.json({ success: true });
    } catch (e) { res.status(401).json({ error: 'Ошибка' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на ${PORT}`));
