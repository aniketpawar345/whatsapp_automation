/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Download,
  Upload,
  MessageSquare,
  UserPlus,
  FileSpreadsheet,
  Save,
  Copy,
  CheckCircle2,
  Phone,
  User,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  status: 'pending' | 'verified' | 'invalid';
}

export default function App() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- WhatsApp State ---
  const [wsStatus, setWsStatus] = useState<{
    ready: boolean,
    hasQR: boolean,
    user?: { name?: string, number?: string } | null
  }>({ ready: false, hasQR: false });
  const [wsQR, setWsQR] = useState<string | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [createdGroups, setCreatedGroups] = useState<any[]>([]);
  const [whatsappChats, setWhatsappChats] = useState<any[]>([]);
  const [groupCreated, setGroupCreated] = useState(false);

  // --- Persistence ---
  useEffect(() => {
    fetch('/api/contacts')
      .then(res => res.json())
      .then(data => {
        setContacts(data);
        setLoading(false);
        setLastSynced(new Date());
      })
      .catch(err => {
        console.error('Failed to fetch contacts:', err);
        setLoading(false);
      });

    const fetchGroups = () => {
      fetch('/api/whatsapp/groups')
        .then(res => res.json())
        .then(data => setCreatedGroups(data))
        .catch(() => { });
    };

    const fetchChats = () => {
      fetch('/api/whatsapp/chats')
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setWhatsappChats(data);
        })
        .catch(() => { });
    };

    fetchGroups();
    fetchChats();

    // Check WhatsApp status every 2 seconds
    const statusInterval = setInterval(() => {
      fetch('/api/whatsapp/status')
        .then(res => res.json())
        .then(status => {
          setWsStatus(status);
          if (status.hasQR && !status.ready) {
            fetch('/api/whatsapp/qr')
              .then(res => res.json())
              .then(data => setWsQR(data.qr))
              .catch(() => { });
          } else {
            setWsQR(null);
          }

          if (status.ready) {
            fetchChats();
          }
        })
        .catch(() => { });

      fetchGroups();
    }, 2000);

    return () => clearInterval(statusInterval);
  }, []);

  const logoutWhatsApp = async () => {
    if (!window.confirm("Are you sure you want to disconnect WhatsApp?")) return;
    try {
      await fetch('/api/whatsapp/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const createWhatsAppGroup = async () => {
    const groupName = window.prompt("Enter Group Name:", "New WhatsApp Group");
    if (!groupName) return;

    setIsCreatingGroup(true);
    try {
      const res = await fetch('/api/whatsapp/create-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName })
      });
      const data = await res.json();
      if (data.success) {
        setGroupCreated(true);
        setTimeout(() => setGroupCreated(false), 8000);

        // Show detailed results if available
        if (data.participantsCount < contacts.length) {
          console.log("Group created, but some participants were skipped:", data.fullResponse);
        }

        // Refresh groups list
        fetch('/api/whatsapp/groups')
          .then(res => res.json())
          .then(data => setCreatedGroups(data))
          .catch(() => { });
      } else {
        alert(`Creation Failed: ${data.error}`);
      }
    } catch (err) {
      alert("Failed to create group. Make sure WhatsApp is connected.");
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const syncToBackend = async (data: Contact[]) => {
    setIsSyncing(true);
    try {
      await fetch('/api/contacts/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setLastSynced(new Date());
    } catch (err) {
      console.error('Failed to sync contacts:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const verifyAllContacts = async () => {
    setIsVerifying(true);
    try {
      const res = await fetch('/api/contacts/verify', { method: 'POST' });
      const results = await res.json();
      setContacts(results);
    } catch (err) {
      console.error('Failed to verify:', err);
    } finally {
      setIsVerifying(false);
    }
  };

  // --- Handlers ---
  const addRow = () => {
    const newContact: Contact = {
      id: Math.random().toString(36).substr(2, 9),
      name: '',
      phone: '',
      status: 'pending'
    };
    const updated = [...contacts, newContact];
    setContacts(updated);
    syncToBackend(updated);
  };

  const updateContact = (id: string, field: keyof Contact, value: string) => {
    const updated = contacts.map(c => {
      if (c.id === id) {
        const newStatus = field === 'phone' ? 'pending' : c.status;
        return { ...c, [field]: value, status: newStatus };
      }
      return c;
    });
    setContacts(updated);
    syncToBackend(updated);
  };

  const removeContact = (id: string) => {
    const updated = contacts.filter(c => c.id !== id);
    setContacts(updated);
    syncToBackend(updated);
  };

  const clearAllContacts = async () => {
    if (!window.confirm('Are you sure you want to delete all contacts? This cannot be undone.')) return;

    setIsSyncing(true);
    try {
      await fetch('/api/contacts', { method: 'DELETE' });
      setContacts([]);
      setLastSynced(new Date());
    } catch (err) {
      console.error('Failed to clear contacts:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const exportToExcel = () => {
    const data = contacts.map(({ name, phone }) => ({ Name: name, 'Phone Number': phone }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contacts");
    XLSX.writeFile(wb, "contacts.xlsx");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws) as any[];

      const newContacts: Contact[] = data.map((item: any) => {
        // More robust key finding for different Excel headers
        const findKey = (patterns: string[]) =>
          Object.keys(item).find(k => patterns.some(p => k.toLowerCase().includes(p.toLowerCase())));

        const nameKey = findKey(['name', 'full name']) || 'Name';
        const phoneKey = findKey(['phone', 'mobile', 'contact', 'number']) || 'Phone Number';

        let rawPhone = String(item[phoneKey] || '').trim();

        // Logical formatting:
        // If it's just 10 digits (no + or leading 91), add +91
        const digitsOnly = rawPhone.replace(/\D/g, '');
        if (digitsOnly.length === 10 && !rawPhone.startsWith('+') && !rawPhone.startsWith('91')) {
          rawPhone = `+91 ${rawPhone}`;
        }

        return {
          id: Math.random().toString(36).substr(2, 9),
          name: String(item[nameKey] || '').trim(),
          phone: rawPhone,
          status: 'pending'
        };
      });

      // Replace current list with new contacts from Excel for "Instant" feel
      setContacts(newContacts);
      await syncToBackend(newContacts);

      // Automatically trigger verification to update the status column
      await verifyAllContacts();
    };
    reader.readAsBinaryString(file);
  };

  const generateVCard = () => {
    let vcard = "";
    contacts.forEach(contact => {
      if (contact.name && contact.phone) {
        vcard += "BEGIN:VCARD\n";
        vcard += "VERSION:3.0\n";
        vcard += `FN:${contact.name}\n`;
        vcard += `TEL;TYPE=CELL:${contact.phone}\n`;
        vcard += "END:VCARD\n";
      }
    });

    const blob = new Blob([vcard], { type: "text/vcard" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'contacts.vcf');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyNumbersForWhatsApp = () => {
    const verifiedContacts = contacts.filter(c => c.status === 'verified');

    if (verifiedContacts.length === 0 && contacts.length > 0) {
      if (!window.confirm("No numbers have been verified yet. Copy all numbers?")) return;
    }

    const numbers = (verifiedContacts.length > 0 ? verifiedContacts : contacts)
      .map(c => String(c.phone || '').replace(/\D/g, ''))
      .filter(n => n.length > 0)
      .join(', ');

    navigator.clipboard.writeText(numbers);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-emerald-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
              <UserPlus size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold tracking-tight">ContactSync</h1>
                {isSyncing && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-tighter"
                  >
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    Syncing
                  </motion.div>
                )}
              </div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">WhatsApp Group Tool</p>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <Upload size={16} />
              Import Excel
            </button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileUpload}
            />
            <button
              onClick={exportToExcel}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <Download size={16} />
              Export Excel
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">

          {/* Main Spreadsheet Area */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-12 text-center">#</th>
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <User size={14} />
                          Full Name
                        </div>
                      </th>
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <Phone size={14} />
                          Phone Number
                        </div>
                      </th>
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={14} />
                          Status
                        </div>
                      </th>
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider w-20"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <AnimatePresence initial={false} mode="popLayout">
                      {loading ? (
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm">
                            <div className="flex flex-col items-center gap-2">
                              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                              Loading contacts...
                            </div>
                          </td>
                        </motion.tr>
                      ) : contacts.length === 0 ? (
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                        >
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm italic">
                            No contacts yet. Add your first one below or import from Excel.
                          </td>
                        </motion.tr>
                      ) : (
                        contacts.map((contact, index) => (
                          <motion.tr
                            key={contact.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            layout
                            className="group hover:bg-gray-50/50 transition-colors"
                          >
                            <td className="px-6 py-4 text-sm text-gray-400 text-center font-mono">
                              {index + 1}
                            </td>
                            <td className="px-6 py-3">
                              <input
                                type="text"
                                value={contact.name}
                                onChange={(e) => updateContact(contact.id, 'name', e.target.value)}
                                placeholder="Enter name..."
                                className="w-full bg-transparent border-none focus:ring-0 text-sm font-medium placeholder:text-gray-300"
                              />
                            </td>
                            <td className="px-6 py-3">
                              <input
                                type="tel"
                                value={contact.phone}
                                onChange={(e) => updateContact(contact.id, 'phone', e.target.value)}
                                placeholder="+1 234 567 890"
                                className="w-full bg-transparent border-none focus:ring-0 text-sm font-mono placeholder:text-gray-300"
                              />
                            </td>
                            <td className="px-6 py-3">
                              {contact.status === 'verified' && (
                                <div className="flex items-center gap-1.5 text-emerald-600 text-[10px] font-bold uppercase tracking-wider">
                                  <CheckCircle2 size={12} />
                                  Verified
                                </div>
                              )}
                              {contact.status === 'invalid' && (
                                <div className="flex items-center gap-1.5 text-red-500 text-[10px] font-bold uppercase tracking-wider">
                                  <X size={12} />
                                  Invalid Format
                                </div>
                              )}
                              {contact.status === 'pending' && (
                                <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-bold uppercase tracking-wider">
                                  <div className="w-2 h-2 bg-gray-200 rounded-full" />
                                  Pending
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-3 text-right">
                              <button
                                onClick={() => removeContact(contact.id)}
                                className="p-2 text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>

              <div className="p-4 bg-gray-50/50 border-t border-gray-100">
                <button
                  onClick={addRow}
                  className="w-full py-3 flex items-center justify-center gap-2 text-sm font-medium text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors border-2 border-dashed border-emerald-200"
                >
                  <Plus size={18} />
                  Add New Contact
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar Actions */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Actions</h2>

              <div className="space-y-3">
                <button
                  onClick={generateVCard}
                  disabled={contacts.length === 0}
                  className="w-full flex items-center gap-3 p-4 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:shadow-none"
                >
                  <Save size={20} />
                  <div className="text-left">
                    <p className="text-sm">Sync to Phone</p>
                    <p className="text-[10px] opacity-80 font-normal">Download .vcf file</p>
                  </div>
                </button>

                <button
                  onClick={verifyAllContacts}
                  disabled={contacts.length === 0 || isVerifying}
                  className={cn(
                    "w-full flex items-center gap-3 p-4 rounded-xl font-medium transition-all border",
                    isVerifying
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-white border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm shadow-gray-100"
                  )}
                >
                  <CheckCircle2 size={20} className={cn(isVerifying && "animate-pulse")} />
                  <div className="text-left">
                    <p className="text-sm">Verify People</p>
                    <p className="text-[10px] opacity-80 font-normal">Check phone formats</p>
                  </div>
                </button>

                <button
                  onClick={copyNumbersForWhatsApp}
                  disabled={contacts.length === 0}
                  className={cn(
                    "w-full flex items-center gap-3 p-4 rounded-xl font-medium transition-all border shadow-lg shadow-emerald-50",
                    copySuccess
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-emerald-600 border-emerald-700 text-white hover:bg-emerald-700"
                  )}
                >
                  {copySuccess ? <CheckCircle2 size={20} /> : <Copy size={20} />}
                  <div className="text-left">
                    <p className="text-sm">WhatsApp Group Helper</p>
                    <p className="text-[10px] opacity-80 font-normal">Copy verified numbers only</p>
                  </div>
                </button>

                {/* WhatsApp Automation Section */}
                <div className="pt-4 border-t border-gray-100 space-y-4">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest">WhatsApp Automation</h3>

                  {!wsStatus.ready && wsQR && (
                    <div className="flex flex-col items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                      <p className="text-xs font-semibold text-gray-600 text-center">Scan to connect WhatsApp</p>
                      <img src={wsQR} alt="WhatsApp QR" className="w-40 h-40 rounded-lg shadow-md border border-white" />
                      <p className="text-[10px] text-gray-400 text-center">Open WhatsApp &gt; Linked Devices &gt; Link a Device</p>
                    </div>
                  )}

                  {wsStatus.ready && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                            {(wsStatus.user?.name || 'W').charAt(0).toUpperCase()}
                          </div>
                          <div className="text-left overflow-hidden">
                            <p className="text-xs font-bold text-emerald-900 truncate">
                              {wsStatus.user?.name || 'Connected'}
                            </p>
                            <p className="text-[10px] text-emerald-600 font-mono">
                              +{wsStatus.user?.number}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={logoutWhatsApp}
                          className="p-1.5 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors"
                          title="Disconnect WhatsApp"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <button
                        onClick={createWhatsAppGroup}
                        disabled={isCreatingGroup || contacts.length === 0}
                        className={cn(
                          "w-full flex items-center gap-3 p-4 rounded-xl font-medium border transition-all",
                          groupCreated
                            ? "bg-blue-600 border-blue-700 text-white shadow-blue-200"
                            : "bg-white border-blue-100 text-blue-600 hover:bg-blue-50 shadow-sm"
                        )}
                      >
                        {isCreatingGroup ? (
                          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        ) : groupCreated ? (
                          <CheckCircle2 size={20} />
                        ) : (
                          <MessageSquare size={20} />
                        )}
                        <div className="text-left">
                          <p className="text-sm">{groupCreated ? 'Group Created!' : 'Create Group Instantly'}</p>
                          <p className={cn("text-[10px] font-normal", groupCreated ? "text-blue-100" : "opacity-80")}>
                            {groupCreated ? 'Check your WhatsApp' : 'Auto-add all contacts'}
                          </p>
                        </div>
                      </button>

                      {whatsappChats.length > 0 && (
                        <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
                          <div className="flex items-center justify-between">
                            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Live Connection Status</h4>
                            <div className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                              <span className="text-[9px] text-emerald-600 font-bold uppercase">Live</span>
                            </div>
                          </div>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                            {whatsappChats.map(chat => (
                              <div key={chat.id} className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-lg transition-colors border border-transparent hover:border-gray-100">
                                <div className="w-6 h-6 bg-gray-200 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] text-gray-500 font-bold">
                                  {chat.name?.charAt(0) || '?'}
                                </div>
                                <div className="text-left overflow-hidden flex-1">
                                  <div className="flex items-center justify-between">
                                    <p className="text-[10px] font-bold text-gray-700 truncate">{chat.name}</p>
                                    {chat.unreadCount > 0 && (
                                      <span className="bg-emerald-500 text-white text-[8px] px-1 rounded-full">{chat.unreadCount}</span>
                                    )}
                                  </div>
                                  <p className="text-[8px] text-gray-400">{chat.isGroup ? 'Group' : 'Direct Message'}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {createdGroups.length > 0 && (
                        <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
                          <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Recent Groups</h4>
                          <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                            {createdGroups.map(group => (
                              <div key={group.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100">
                                <div className="text-left overflow-hidden">
                                  <p className="text-[11px] font-semibold text-gray-700 truncate">{group.name}</p>
                                  <p className="text-[9px] text-gray-400">{group.participants_count} members</p>
                                </div>
                                <div className="flex items-center gap-1 text-[9px] text-emerald-600 font-bold whitespace-nowrap">
                                  <CheckCircle2 size={10} />
                                  Created
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!wsStatus.ready && !wsQR && (
                    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl text-gray-500">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                      <span className="text-[10px] font-medium">Initializing WhatsApp...</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={clearAllContacts}
                  disabled={contacts.length === 0 || isSyncing}
                  className="w-full flex items-center gap-3 p-4 bg-white border border-red-100 text-red-500 rounded-xl font-medium hover:bg-red-50 transition-all disabled:opacity-30 disabled:grayscale transition-colors"
                >
                  <Trash2 size={20} />
                  <div className="text-left">
                    <p className="text-sm">Clear All</p>
                    <p className="text-[10px] opacity-80 font-normal">Delete everything</p>
                  </div>
                </button>
              </div>

              {lastSynced && (
                <div className="flex items-center justify-center gap-2 text-[10px] text-gray-400 font-medium italic">
                  <CheckCircle2 size={10} />
                  Last synced: {lastSynced.toLocaleTimeString()}
                </div>
              )}

              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-xl text-blue-700">
                  <MessageSquare size={20} className="shrink-0 mt-0.5" />
                  <div className="text-xs space-y-2">
                    <p className="font-semibold">How to use:</p>
                    <ol className="list-decimal ml-4 space-y-1 opacity-90">
                      <li>Add names and numbers in the sheet.</li>
                      <li>Click <b>Sync to Phone</b> and open the file on your mobile.</li>
                      <li>Save all contacts to your phonebook.</li>
                      <li>Click <b>WhatsApp Helper</b> to copy numbers.</li>
                      <li>In WhatsApp, create a <b>New Group</b> and paste the numbers.</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-emerald-900 p-6 rounded-2xl text-white shadow-xl">
              <div className="flex items-center gap-2 mb-4">
                <FileSpreadsheet size={20} className="text-emerald-400" />
                <h3 className="text-sm font-semibold">Stats</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold">{contacts.length}</p>
                  <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-medium">Total Contacts</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{contacts.filter(c => c.name && c.phone).length}</p>
                  <p className="text-[10px] text-emerald-400 uppercase tracking-wider font-medium">Complete</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-gray-200 mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 opacity-40 grayscale hover:grayscale-0 transition-all">
          <div className="flex items-center gap-2">
            <UserPlus size={16} />
            <span className="text-sm font-semibold tracking-tighter">CONTACTSYNC v1.0</span>
          </div>
          <p className="text-xs font-medium">Crafted for seamless mobile contact management.</p>
        </div>
      </footer>
    </div>
  );
}
