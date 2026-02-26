import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import qrcode from 'qrcode';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const db = new Database(join(__dirname, 'contacts.db'));

// WhatsApp Client Setup
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: join(__dirname, '.wwebjs_auth')
    }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
    }
});

let qrCodeData = '';
let isClientReady = false;
let connectedUser: { name?: string, number?: string } | null = null;

client.on('qr', (qr) => {
    qrCodeData = qr;
    connectedUser = null;
    console.log('QR RECEIVED');
});

client.on('ready', async () => {
    isClientReady = true;
    qrCodeData = '';
    const info = client.info;
    connectedUser = {
        name: info.pushname,
        number: info.wid.user
    };
    console.log('WhatsApp Client is ready for:', connectedUser.name || connectedUser.number);
});

client.on('auth_failure', (msg) => {
    console.error('AUTHENTICATION FAILURE', msg);
});

client.on('disconnected', (reason) => {
    isClientReady = false;
    qrCodeData = '';
    console.log('Client was logged out', reason);
    // client.initialize(); // Sometimes it's better to manual restart or handle as needed
});

client.initialize().catch(err => console.error('Failed to initialize WhatsApp client:', err));

app.use(express.json());

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS created_groups (
    id TEXT PRIMARY KEY,
    name TEXT,
    participants_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Migration: Ensure 'status' column exists for existing databases
try {
    db.exec("ALTER TABLE contacts ADD COLUMN status TEXT DEFAULT 'pending'");
} catch (e) {
    // Column already exists, ignore error
}

// API Endpoints
app.get('/api/whatsapp/status', (req, res) => {
    res.json({
        ready: isClientReady,
        hasQR: !!qrCodeData,
        user: connectedUser
    });
});

app.get('/api/whatsapp/qr', async (req, res) => {
    if (isClientReady) {
        return res.status(400).json({ error: 'Client is already ready' });
    }
    if (!qrCodeData) {
        return res.status(404).json({ error: 'QR not generated yet. Please wait.' });
    }
    try {
        const url = await qrcode.toDataURL(qrCodeData);
        res.json({ qr: url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR Image' });
    }
});

app.get('/api/whatsapp/groups', (req, res) => {
    try {
        const groups = db.prepare("SELECT * FROM created_groups ORDER BY created_at DESC").all();
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/whatsapp/chats', async (req, res) => {
    if (!isClientReady) {
        return res.status(400).json({ error: 'WhatsApp is not connected' });
    }
    try {
        const chats = await client.getChats();
        // Return top 10 recent chats with basic info
        const recentChats = chats.slice(0, 10).map(chat => ({
            id: chat.id._serialized,
            name: chat.name,
            timestamp: chat.timestamp,
            isGroup: chat.isGroup,
            unreadCount: chat.unreadCount
        }));
        res.json(recentChats);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.post('/api/whatsapp/logout', async (req, res) => {
    try {
        await client.logout();
        isClientReady = false;
        qrCodeData = '';
        connectedUser = null;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.post('/api/whatsapp/create-group', async (req, res) => {
    if (!isClientReady) {
        return res.status(400).json({ error: 'WhatsApp is not connected' });
    }

    const { groupName } = req.body;
    if (!groupName) {
        return res.status(400).json({ error: 'Group name is required' });
    }

    try {
        const allContacts = db.prepare("SELECT phone FROM contacts").all();
        if (allContacts.length === 0) {
            return res.status(400).json({ error: 'No contacts found. Please add or import contacts first.' });
        }

        const participants: string[] = [];
        for (const contact of allContacts) {
            let clean = contact.phone.replace(/\D/g, '');
            // Simple logic: if 10 digits, it's likely Indian without country code
            if (clean.length === 10) {
                clean = '91' + clean;
            }
            if (clean.length >= 10) {
                participants.push(`${clean}@c.us`);
            }
        }

        if (participants.length === 0) {
            return res.status(400).json({ error: 'No valid phone numbers found (need at least 10 digits including country code).' });
        }

        console.log(`[WHATSAPP] Attempting to create group: "${groupName}" with ${participants.length} participants`);
        console.log(`[WHATSAPP] Participants:`, participants);

        const groupResponse: any = await client.createGroup(groupName, participants);

        console.log('[WHATSAPP] Raw Response:', JSON.stringify(groupResponse, null, 2));

        // Sometimes gid is in a different place depending on version
        const gid = groupResponse.gid?._serialized || groupResponse.gid || groupResponse.id?._serialized || groupResponse.id;

        if (!gid) {
            console.error('[WHATSAPP] Could not find GID in response');
            throw new Error('Group created but WhatsApp returned an empty ID. Check your phone.');
        }

        // Check if any participants were actually added
        const participantsStatus = groupResponse.participants || {};
        const addedParticipants = Object.keys(participantsStatus).filter(p => participantsStatus[p].code === 200).length;

        db.prepare("INSERT INTO created_groups (id, name, participants_count) VALUES (?, ?, ?)")
            .run(gid, groupName, addedParticipants || participants.length);

        res.json({
            success: true,
            gid,
            participantsCount: addedParticipants || participants.length,
            fullResponse: groupResponse
        });
    } catch (error) {
        console.error('[WHATSAPP] Critical Creation Error:', error);
        res.status(500).json({ error: (error as Error).message });
    }
});

app.get('/api/contacts', (req, res) => {
    try {
        const contacts = db.prepare('SELECT * FROM contacts ORDER BY created_at ASC').all();
        res.json(contacts);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.post('/api/contacts/verify', (req, res) => {
    try {
        const contacts = db.prepare('SELECT * FROM contacts').all();
        const updateStmt = db.prepare('UPDATE contacts SET status = ?, phone = ? WHERE id = ?');

        const results = contacts.map((c: any) => {
            const phoneNumber = parsePhoneNumberFromString(c.phone);
            let status = 'invalid';

            // Just check if it's valid, but don't force reformat if it's already what the user wants
            if (phoneNumber && phoneNumber.isValid()) {
                status = 'verified';
            } else if (c.phone.replace(/\D/g, '').length >= 10) {
                // If it's 10+ digits, we'll consider it good for WhatsApp even if libphonenumber is picky
                status = 'verified';
            }

            updateStmt.run(status, c.phone, c.id);
            return { ...c, status, phone: c.phone };
        });

        res.json(results);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.post('/api/contacts/sync', (req, res) => {
    try {
        const contacts = req.body;

        const deleteStmt = db.prepare('DELETE FROM contacts');
        const insertStmt = db.prepare('INSERT INTO contacts (id, name, phone, status) VALUES (?, ?, ?, ?)');

        const sync = db.transaction((data) => {
            deleteStmt.run();
            for (const contact of data) {
                insertStmt.run(contact.id, contact.name, contact.phone, contact.status || 'pending');
            }
        });

        sync(contacts);
        res.json({ success: true, count: contacts.length });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.delete('/api/contacts', (req, res) => {
    try {
        db.prepare('DELETE FROM contacts').run();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.post('/api/contacts', (req, res) => {
    try {
        const { id, name, phone } = req.body;
        db.prepare('INSERT INTO contacts (id, name, phone) VALUES (?, ?, ?)').run(id, name, phone);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.put('/api/contacts/:id', (req, res) => {
    try {
        const { name, phone } = req.body;
        db.prepare('UPDATE contacts SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

app.delete('/api/contacts/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Backend server running on port ${PORT}`);
});
