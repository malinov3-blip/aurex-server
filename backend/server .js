const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- НАСТРОЙКИ SUPABASE ---
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uigfryghaqyekhzwgxgx.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'ТВОЙ_SERVICE_ROLE_KEY_СЮДА';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const JWT_SECRET = process.env.JWT_SECRET || 'aurex_secret_2024';

// ==================== РЕГИСТРАЦИЯ ====================
app.post('/api/register', async (req, res) => {
    const { email, phone, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Заполните поля' });

    const { data: existing } = await supabase.from('users').select('email').eq('email', email).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Email уже занят' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const { error } = await supabase.from('users').insert({
        email, phone, password: hashedPassword, balance: 0, is_admin: false
    });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, message: 'Аккаунт создан' });
});

// ==================== ВХОД ====================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('email', email).single();

    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Неверный пароль' });

    const token = jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, JWT_SECRET);
    res.json({ token, user: { email: user.email, balance: user.balance, is_admin: user.is_admin } });
});

// ==================== ДАННЫЕ ====================
app.get('/api/me', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { data: user } = await supabase.from('users').select('*').eq('email', decoded.email).single();
        res.json(user);
    } catch (e) {
        res.status(401).json({ error: 'Ошибка' });
    }
});

// ==================== СТАКАН ====================
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
    } catch (e) {
        res.status(401).json({ error: 'Ошибка' });
    }
});

// ==================== ЧАТ ====================
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
    } catch (e) {
        res.status(401).json({ error: 'Ошибка' });
    }
});

// ==================== P2P ====================
app.get('/api/p2p', async (req, res) => {
    const { data } = await supabase.from('p2p_offers').select('*').order('created_at', { ascending: false });
    res.json(data || []);
});

app.post('/api/p2p', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const { asset, price, amount } = req.body;
        await supabase.from('p2p_offers').insert({ seller_email: decoded.email, asset, price, amount });
        res.json({ success: true });
    } catch (e) {
        res.status(401).json({ error: 'Ошибка' });
    }
});

// ==================== АДМИН ====================
app.get('/api/admin/users', async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Нет токена' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (!decoded.is_admin) return res.status(403).json({ error: 'Нет прав' });
        const { data: users } = await supabase.from('users').select('*');
        res.json(users);
    } catch (e) {
        res.status(401).json({ error: 'Ошибка' });
    }
});

// ==================== ЗАПУСК ====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер AUREX запущен на порту ${PORT}`);
});