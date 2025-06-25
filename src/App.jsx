import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, setDoc, getDocs, writeBatch, query, where, Timestamp, setLogLevel } from 'firebase/firestore';
import { Plus, Trash2, Edit, Save, X, Users, Percent, DollarSign, ChevronDown, ChevronUp, UserPlus, Repeat, Send, ArrowRight, ListOrdered, Sun, Moon, Calendar } from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyCpJH5kbQydBPzFtwoaNTWm9-c_8IMCAjk",
  authDomain: "expense-tracker-c3c36.firebaseapp.com",
  projectId: "expense-tracker-c3c36",
  storageBucket: "expense-tracker-c3c36.firebasestorage.app",
  messagingSenderId: "488241985144",
  appId: "1:488241985144:web:a8dba6b02ee78787471f8d",
  measurementId: "G-F6J2YRNYJM"
};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-rental-tracker';

// --- Helper Components ---
const Modal = ({ children, onClose, size = '2xl' }) => (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4">
        <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-${size} max-h-full overflow-y-auto text-gray-800 dark:text-gray-200`}>
            <div className="p-6 relative">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <X size={24} />
                </button>
                {children}
            </div>
        </div>
    </div>
);

// --- Main App Component ---
export default function App() {
    // --- State Management ---
    const [db, setDb] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    
    const [expenses, setExpenses] = useState([]);
    const [settlements, setSettlements] = useState([]);
    const [friends, setFriends] = useState([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
    const [isSettleModalOpen, setIsSettleModalOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState(null);
    const [detailModalFriend, setDetailModalFriend] = useState(null);
    
    const [showManageFriends, setShowManageFriends] = useState(false);
    const [newFriendName, setNewFriendName] = useState('');
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');

    // --- Theme Management ---
     useEffect(() => {
        const root = window.document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };


    // --- Firebase Initialization ---
    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            setDb(firestoreDb);
            setLogLevel('debug');
            onAuthStateChanged(getAuth(app), async (user) => {
                if (!user) await signInAnonymously(getAuth(app));
                setIsAuthReady(true);
            });
        } catch (e) { console.error("Firebase init error:", e); setError("Could not connect to the database."); setIsLoading(false); }
    }, []);

    // --- Data Fetching & Recurring Expense Processing ---
    useEffect(() => {
        if (!isAuthReady || !db) return;

        const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'main');
        const unsubscribeFriends = onSnapshot(configDocRef, (docSnap) => {
             const friendsList = (docSnap.exists() && docSnap.data().friends) ? docSnap.data().friends : ['Friend 1', 'Friend 2', 'Friend 3', 'Friend 4', 'Friend 5', 'Friend 6', 'Friend 7'];
             if (!docSnap.exists() || !docSnap.data().friends) {
                 setDoc(configDocRef, { friends: friendsList }, { merge: true });
             }
             setFriends(friendsList);
        }, (err) => { console.error(err); setError("Failed to load friend list.") });

        const expensesColRef = collection(db, 'artifacts', appId, 'public', 'data', 'expenses');
        const unsubscribeExpenses = onSnapshot(expensesColRef, (snap) => setExpenses(snap.docs.map(d => ({...d.data(), id: d.id}))), (err) => { console.error(err); setError("Failed to fetch expenses.")});
        
        const settlementsColRef = collection(db, 'artifacts', appId, 'public', 'data', 'settlements');
        const unsubscribeSettlements = onSnapshot(settlementsColRef, (snap) => setSettlements(snap.docs.map(d => ({...d.data(), id: d.id}))), (err) => { console.error(err); setError("Failed to fetch settlements.")});

        const processRecurring = async () => {
            const recurringColRef = collection(db, 'artifacts', appId, 'public', 'data', 'recurring');
            const recurringSnapshot = await getDocs(recurringColRef);
            const batch = writeBatch(db);
            const now = new Date();
            recurringSnapshot.forEach(recDoc => {
                const recurringData = recDoc.data();
                const lastPosted = recurringData.lastPosted.toDate();
                let nextPostDate = new Date(lastPosted.getFullYear(), lastPosted.getMonth() + 1, recurringData.dayOfMonth);
                if (now >= nextPostDate) {
                    const newExpenseData = { ...recurringData, date: Timestamp.fromDate(nextPostDate) };
                    delete newExpenseData.lastPosted; delete newExpenseData.dayOfMonth;
                    batch.set(doc(expensesColRef), newExpenseData); 
                    batch.update(recDoc.ref, { lastPosted: Timestamp.now() });
                }
            });
            await batch.commit();
        };

        processRecurring().then(() => setIsLoading(false)).catch(err => {
            console.error("Error processing recurring payments: ", err);
            setError("Error processing recurring payments.");
            setIsLoading(false);
        });
        
        return () => { unsubscribeFriends(); unsubscribeExpenses(); unsubscribeSettlements(); };
    }, [isAuthReady, db]);

    // --- Core Balance Calculation ---
    const summary = useMemo(() => {
        if (friends.length === 0) return { totalExpense: 0, friendBalances: [] };
        
        const friendData = friends.reduce((acc, friend) => ({ ...acc, [friend]: { balance: 0 } }), {});

        // Calculate balances from expenses
        expenses.forEach(expense => {
            const totalAmount = expense.totalAmount || 0;
            const paidBy = expense.paidBy || [];
            const splits = expense.splits || [];

            paidBy.forEach(p => { 
                if (friendData[p.friend]) friendData[p.friend].balance += p.amount; 
            });

            if (expense.splitType === 'equally') {
                const activeFriends = splits.map(s => s.friend).filter(f => friends.includes(f));
                if (activeFriends.length > 0) {
                    const share = totalAmount / activeFriends.length;
                    activeFriends.forEach(f => { if (friendData[f]) friendData[f].balance -= share; });
                }
            } else { // Percentage
                splits.forEach(s => {
                    if (friendData[s.friend]) {
                        friendData[s.friend].balance -= totalAmount * ((s.percentage || 0) / 100);
                    }
                });
            }
        });

        // Apply settlements
        settlements.forEach(settlement => {
            if(friendData[settlement.from]) friendData[settlement.from].balance += settlement.amount; 
            if(friendData[settlement.to]) friendData[settlement.to].balance -= settlement.amount; 
        });

        const friendBalances = friends.map(friend => ({ friend, balance: friendData[friend].balance }));
        const totalExpense = expenses.reduce((sum, ex) => sum + (ex.totalAmount || 0), 0);
        return { totalExpense, friendBalances };
    }, [expenses, settlements, friends]);

    // --- Event Handlers ---
    const handleAddFriend = async () => {
        if (!db || !newFriendName.trim()) return;
        const newFriendsList = [...friends, newFriendName.trim()];
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'main'), { friends: newFriendsList }, { merge: true });
        setNewFriendName('');
    };
    
    const handleRemoveFriend = async (friendToRemove) => {
        const newFriendsList = friends.filter(f => f !== friendToRemove);
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'main'), { friends: newFriendsList }, { merge: true });
    };

    const handleDeleteExpense = async (id) => await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'expenses', id));
    
    const handleSaveExpense = async (expenseData, isRecurring, dayOfMonth) => {
        if (!db) return;
        const colPath = isRecurring ? 'recurring' : 'expenses';
        const fullColPath = collection(db, 'artifacts', appId, 'public', 'data', colPath);
        let dataToSave = {...expenseData};
        if(isRecurring) {
            dataToSave.dayOfMonth = dayOfMonth;
            dataToSave.lastPosted = Timestamp.fromDate(new Date(1970, 0, 1)); 
        } else {
             dataToSave.date = Timestamp.fromDate(new Date(dataToSave.date));
        }
        if (editingExpense) { 
            const expenseDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'expenses', editingExpense.id);
            await updateDoc(expenseDocRef, dataToSave);
        } else {
            await addDoc(fullColPath, dataToSave);
        }
        setIsExpenseModalOpen(false); setEditingExpense(null);
    };

    const handleSaveSettlement = async ({ from, to, amount, date }) => {
        if(!db || !from || !to || !amount) return;
        const settlementsColRef = collection(db, 'artifacts', appId, 'public', 'data', 'settlements');
        await addDoc(settlementsColRef, {from, to, amount: parseFloat(amount), date: Timestamp.fromDate(new Date(date)) });
        setIsSettleModalOpen(false);
    };
    
    // --- Render Helpers ---
    const renderBalance = (balance) => {
        if (Math.abs(balance) < 0.01) return <span className="text-gray-500 dark:text-gray-400 font-semibold">is settled</span>;
        return balance > 0 ? <span className="text-green-500 font-semibold">is owed ₹{Math.abs(balance).toFixed(2)}</span> : <span className="text-red-500 font-semibold">owes ₹{Math.abs(balance).toFixed(2)}</span>;
    };
    
    const renderPaidBy = (paidBy) => {
        if (!paidBy || paidBy.length === 0) return <span className="text-gray-400">Unpaid</span>;
        if (paidBy.length === 1) return <span className="bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold px-2 py-1 rounded-full">{paidBy[0].friend}</span>;
        return <span className="bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-xs font-semibold px-2 py-1 rounded-full">{paidBy.length} payers</span>;
    };

    return (
        <div className="bg-gray-50 dark:bg-gray-900 min-h-screen font-sans text-gray-800 dark:text-gray-200 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8 text-center relative">
                    <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100 tracking-tight">Rental Expense Tracker</h1>
                    <div className="mt-4 text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-full px-4 py-2 inline-block">App ID: <strong className="font-mono text-gray-600 dark:text-gray-300">{appId}</strong></div>
                    {error && <p className="mt-4 text-red-500 bg-red-100 p-3 rounded-lg">{error}</p>}
                    <button onClick={toggleTheme} className="absolute top-0 right-0 p-2 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                        {theme === 'light' ? <Moon size={20}/> : <Sun size={20}/>}
                    </button>
                </div>
                <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 mb-8"><h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-3">Overall Balance Overview</h3><div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-x-4 gap-y-3">{summary.friendBalances.map(({ friend, balance }) => (<button key={friend} onClick={() => setDetailModalFriend(friend)} className="text-left p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"><span className="font-semibold block">{friend}</span> {renderBalance(balance)}</button>))}</div></div>
                <div className="flex justify-center gap-4 mb-8"><button onClick={() => setIsExpenseModalOpen(true)} className="bg-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-blue-700 transition-all shadow-md flex items-center gap-2"><Plus size={20} /> Add Expense</button><button onClick={() => setIsSettleModalOpen(true)} className="bg-green-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-green-700 transition-all shadow-md flex items-center gap-2"><Send size={20} /> Settle Up</button></div>
                <div className="space-y-4 mb-8">
                    <CollapsibleCard title="Manage Friends" icon={<Users/>}><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><h4 className="font-semibold mb-2">Current Friends ({friends.length})</h4><ul className="space-y-2 max-h-48 overflow-y-auto pr-2">{friends.map(f => <li key={f} className="flex justify-between items-center bg-gray-100 dark:bg-gray-700 p-2 rounded-lg"><span>{f}</span><button onClick={() => handleRemoveFriend(f)} className="p-1 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full"><Trash2 size={16} /></button></li>)}</ul></div><div><h4 className="font-semibold mb-2">Add New Friend</h4><div className="flex gap-2"><input type="text" value={newFriendName} onChange={e => setNewFriendName(e.target.value)} placeholder="New friend's name" className="flex-grow p-2 bg-white dark:bg-gray-600 border dark:border-gray-500 rounded-lg"/><button onClick={handleAddFriend} className="bg-green-500 text-white font-bold p-2 rounded-lg hover:bg-green-600 flex items-center justify-center"><UserPlus size={20}/></button></div></div></div></CollapsibleCard>
                    <MonthlySummary friends={friends} expenses={expenses} settlements={settlements} />
                    <TransactionLog friends={friends} expenses={expenses} settlements={settlements} />
                </div>
                <div className="mt-8 bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700"><div className="overflow-x-auto"><table className="w-full text-left"><thead className="border-b border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50"><tr><th className="p-4 font-semibold text-sm text-gray-600 dark:text-gray-300">Date</th><th className="p-4 font-semibold text-sm text-gray-600 dark:text-gray-300">Description</th><th className="p-4 font-semibold text-sm text-gray-600 dark:text-gray-300">Amount</th><th className="p-4 font-semibold text-sm text-gray-600 dark:text-gray-300">Paid By</th><th className="p-4 font-semibold text-sm text-right text-gray-600 dark:text-gray-300">Actions</th></tr></thead>
                    <tbody>
                        {isLoading ? (<tr><td colSpan="5" className="text-center p-8 text-gray-500 dark:text-gray-400">Loading...</td></tr>) : 
                         expenses.length === 0 && !error ? (<tr><td colSpan="5" className="text-center p-8 text-gray-500 dark:text-gray-400">No expenses yet.</td></tr>) :
                         (expenses.sort((a, b) => b.date.toDate() - a.date.toDate()).map(expense => (
                            <tr key={expense.id} className="border-b last:border-b-0 border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                                <td className="p-4 text-sm">{expense.date.toDate().toLocaleDateString()}</td><td className="p-4 font-medium">{expense.description}</td>
                                <td className="p-4">₹{parseFloat(expense.totalAmount).toFixed(2)}</td><td className="p-4">{renderPaidBy(expense.paidBy)}</td>
                                <td className="p-4 text-right"><div className="flex justify-end items-center gap-2">
                                    <button onClick={() => { setEditingExpense(expense); setIsExpenseModalOpen(true); }} className="p-2 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full"><Edit size={16} /></button>
                                    <button onClick={() => handleDeleteExpense(expense.id)} className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full"><Trash2 size={16} /></button>
                                </div></td>
                            </tr>
                         )))}
                    </tbody>
                </table></div></div>
                
                {isExpenseModalOpen && <ExpenseFormModal friends={friends} expense={editingExpense} onSave={handleSaveExpense} onClose={() => {setIsExpenseModalOpen(false); setEditingExpense(null);}} />}
                {isSettleModalOpen && <SettleUpModal friends={friends} onSave={handleSaveSettlement} onClose={() => setIsSettleModalOpen(false)} />}
                {detailModalFriend && <FriendDetailModal friend={detailModalFriend} allFriends={friends} allExpenses={expenses} allSettlements={settlements} onClose={() => setDetailModalFriend(null)} />}
            </div>
        </div>
    );
}

const CollapsibleCard = ({ title, icon, children }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button onClick={() => setIsOpen(!isOpen)} className="w-full p-4 text-left font-semibold text-lg flex justify-between items-center bg-gray-50 hover:bg-gray-100 dark:bg-gray-700/50 dark:hover:bg-gray-700">
                <span className="flex items-center gap-2">{icon} {title}</span>
                {isOpen ? <ChevronUp /> : <ChevronDown />}
            </button>
            {isOpen && <div className="p-6">{children}</div>}
        </div>
    );
}

function MonthlySummary({ friends, expenses, settlements }) {
    const [selectedDate, setSelectedDate] = useState({ month: new Date().getMonth(), year: new Date().getFullYear() });

    const monthlyData = useMemo(() => {
        const filteredExpenses = expenses.filter(e => {
            const date = e.date.toDate();
            return date.getFullYear() === selectedDate.year && date.getMonth() === selectedDate.month;
        });
        const filteredSettlements = settlements.filter(s => {
            const date = s.date.toDate();
            return date.getFullYear() === selectedDate.year && date.getMonth() === selectedDate.month;
        });

        const totalExpenditure = filteredExpenses.reduce((sum, e) => sum + e.totalAmount, 0);

        const expenseSummary = filteredExpenses.reduce((acc, e) => {
            const category = e.description.trim().toLowerCase();
            acc[category] = (acc[category] || 0) + e.totalAmount;
            return acc;
        }, {});
        
        const balanceSummary = friends.reduce((acc, friend) => {
            let balance = 0;
            filteredExpenses.forEach(exp => {
                const paidBy = (exp.paidBy || []).find(p => p.friend === friend)?.amount || 0;
                let share = 0;
                if (exp.splitType === 'equally') {
                    const activeFriends = (exp.splits || []).filter(s => friends.includes(s.friend));
                    if(activeFriends.some(s => s.friend === friend)) {
                        share = (exp.totalAmount || 0) / activeFriends.length;
                    }
                } else {
                    share = (exp.totalAmount || 0) * ((exp.splits.find(s => s.friend === friend)?.percentage || 0) / 100);
                }
                balance += paidBy - share;
            });
            filteredSettlements.forEach(s => {
                if (s.from === friend) balance += s.amount;
                if (s.to === friend) balance -= s.amount;
            });
            acc[friend] = balance;
            return acc;
        }, {});

        return { totalExpenditure, expenseSummary, balanceSummary };
    }, [selectedDate, friends, expenses, settlements]);

    const handleDateChange = (e) => {
        const { name, value } = e.target;
        setSelectedDate(prev => ({...prev, [name]: parseInt(value)}));
    };

    const renderBalance = (balance) => {
        if (Math.abs(balance) < 0.01) return <span className="text-gray-500 dark:text-gray-400 font-semibold">is settled</span>;
        return balance > 0 ? <span className="text-green-500">Owed ₹{Math.abs(balance).toFixed(2)}</span> : <span className="text-red-500">Owes ₹{Math.abs(balance).toFixed(2)}</span>;
    };
    
    const years = [new Date().getFullYear(), new Date().getFullYear() - 1];
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

    return (
         <CollapsibleCard title="Monthly Summary" icon={<Calendar/>}>
            <div className="flex gap-4 mb-4">
                <select name="month" value={selectedDate.month} onChange={handleDateChange} className="p-2 rounded-md border-gray-300 dark:bg-gray-600 dark:border-gray-500">
                    {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
                <select name="year" value={selectedDate.year} onChange={handleDateChange} className="p-2 rounded-md border-gray-300 dark:bg-gray-600 dark:border-gray-500">
                     {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
                    <h4 className="font-semibold mb-2">Total Expenditure</h4>
                    <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">₹{monthlyData.totalExpenditure.toFixed(2)}</p>
                </div>
                 <div className="md:col-span-2 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
                    <h4 className="font-semibold mb-2">Expense Categories</h4>
                     <ul className="space-y-1 text-sm">
                        {Object.entries(monthlyData.expenseSummary).map(([category, amount]) => (
                            <li key={category} className="flex justify-between"><span>{category.charAt(0).toUpperCase() + category.slice(1)}</span><span>₹{amount.toFixed(2)}</span></li>
                        ))}
                    </ul>
                </div>
                <div className="md:col-span-3 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg">
                    <h4 className="font-semibold mb-2">Monthly Balance Summary</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        {Object.entries(monthlyData.balanceSummary).map(([friend, balance]) => (
                            <div key={friend}><span className="font-semibold block">{friend}</span> {renderBalance(balance)}</div>
                        ))}
                    </div>
                </div>
            </div>
         </CollapsibleCard>
    )
}

function TransactionLog({ friends, expenses, settlements }) {
    const [filter, setFilter] = useState('All');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    const transactions = useMemo(() => {
        let combined = [
            ...expenses.map(e => ({ ...e, type: 'expense' })),
            ...settlements.map(s => ({ ...s, type: 'settlement' }))
        ].sort((a, b) => b.date.toDate() - a.date.toDate());

        if (filter !== 'All') {
            combined = combined.filter(t => {
                if (t.type === 'expense') {
                    const involved = new Set(t.splits.map(s => s.friend));
                    t.paidBy.forEach(p => involved.add(p.friend));
                    return involved.has(filter);
                }
                if (t.type === 'settlement') {
                    return t.from === filter || t.to === filter;
                }
                return false;
            });
        }
        
        if (startDate) {
            combined = combined.filter(t => t.date.toDate() >= new Date(startDate));
        }
        if (endDate) {
            const endOfDay = new Date(endDate);
            endOfDay.setHours(23, 59, 59, 999);
            combined = combined.filter(t => t.date.toDate() <= endOfDay);
        }

        return combined;

    }, [friends, expenses, settlements, filter, startDate, endDate]);

    return (
         <CollapsibleCard title="Transaction Log" icon={<ListOrdered/>}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                    <label htmlFor="filter-person" className="text-sm font-medium mr-2">Filter by person:</label>
                    <select id="filter-person" value={filter} onChange={e => setFilter(e.target.value)} className="w-full p-2 rounded-md border-gray-300 dark:bg-gray-600 dark:border-gray-500">
                        <option value="All">All</option>
                        {friends.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                </div>
                 <div>
                    <label htmlFor="filter-start-date" className="text-sm font-medium mr-2">Start Date:</label>
                    <input type="date" id="filter-start-date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full p-2 rounded-md border-gray-300 dark:bg-gray-600 dark:border-gray-500"/>
                </div>
                 <div>
                    <label htmlFor="filter-end-date" className="text-sm font-medium mr-2">End Date:</label>
                    <input type="date" id="filter-end-date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-full p-2 rounded-md border-gray-300 dark:bg-gray-600 dark:border-gray-500"/>
                </div>
            </div>
            <ul className="space-y-3 max-h-96 overflow-y-auto">
                {transactions.map(t => (
                    <li key={`${t.type}-${t.id}`} className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                        {t.type === 'expense' && (
                            <div>
                                <div className="flex justify-between items-center">
                                    <span className="font-bold">{t.description}</span>
                                    <span className="font-bold text-blue-600 dark:text-blue-400">₹{t.totalAmount.toFixed(2)}</span>
                                </div>
                                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">Paid by {t.paidBy.map(p => p.friend).join(', ')} on {t.date.toDate().toLocaleDateString()}</div>
                            </div>
                        )}
                        {t.type === 'settlement' && (
                             <div className="flex justify-between items-center">
                                <div>
                                    <span className="font-semibold text-green-700 dark:text-green-400">{t.from}</span> paid <span className="font-semibold text-blue-700 dark:text-blue-400">{t.to}</span>
                                </div>
                                <span className="font-bold">₹{t.amount.toFixed(2)}</span>
                                <div className="text-xs text-gray-500 dark:text-gray-400">{t.date.toDate().toLocaleDateString()}</div>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
         </CollapsibleCard>
    );
}

function FriendDetailModal({ friend, allFriends, allExpenses, allSettlements, onClose }) {
    const simplifiedDebts = useMemo(() => {
        let balances = allFriends.map(f => {
            let balance = 0;
            allExpenses.forEach(exp => {
                const paidBy = (exp.paidBy || []).find(p => p.friend === f)?.amount || 0;
                let share = 0;
                if (exp.splitType === 'equally') {
                    const activeFriends = (exp.splits || []).filter(s => allFriends.includes(s.friend));
                    if(activeFriends.some(s => s.friend === f)) {
                        share = (exp.totalAmount || 0) / activeFriends.length;
                    }
                } else {
                    share = (exp.totalAmount || 0) * ((exp.splits.find(s => s.friend === f)?.percentage || 0) / 100);
                }
                balance += paidBy - share;
            });
            allSettlements.forEach(s => {
                if (s.from === f) balance += s.amount;
                if (s.to === f) balance -= s.amount;
            });
            return { person: f, balance };
        });

        const debtors = balances.filter(b => b.balance < -0.01).map(b => ({...b}));
        const creditors = balances.filter(b => b.balance > 0.01).map(b => ({...b}));

        const transactions = [];
        
        while(debtors.length > 0 && creditors.length > 0) {
            const debtor = debtors[0];
            const creditor = creditors[0];
            const amount = Math.min(-debtor.balance, creditor.balance);

            transactions.push({ from: debtor.person, to: creditor.person, amount });

            debtor.balance += amount;
            creditor.balance -= amount;
            
            if(Math.abs(debtor.balance) < 0.01) debtors.shift();
            if(Math.abs(creditor.balance) < 0.01) creditors.shift();
        }

        const owesMe = transactions.filter(t => t.to === friend);
        const iOwe = transactions.filter(t => t.from === friend);
        return { owesMe, iOwe };

    }, [friend, allFriends, allExpenses, allSettlements]);


    return (
        <Modal onClose={onClose} size="3xl">
            <h2 className="text-2xl font-bold mb-6">Simplified Debts for {friend}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg">
                    <h3 className="font-semibold text-lg text-green-800 dark:text-green-300 mb-2">Who Owes {friend}</h3>
                    {simplifiedDebts.owesMe.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400">Nobody owes {friend} anything.</p>}
                    <ul className="space-y-3">
                        {simplifiedDebts.owesMe.map(({from, amount}, i) => (
                            <li key={i}><div className="flex justify-between items-center"><span className="font-semibold">{from}</span><span className="font-bold text-green-600 dark:text-green-400">₹{amount.toFixed(2)}</span></div></li>
                        ))}
                    </ul>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                    <h3 className="font-semibold text-lg text-red-800 dark:text-red-300 mb-2">Who {friend} Owes</h3>
                    {simplifiedDebts.iOwe.length === 0 && <p className="text-sm text-gray-600 dark:text-gray-400">{friend} is all settled up!</p>}
                    <ul className="space-y-3">
                         {simplifiedDebts.iOwe.map(({to, amount}, i) => (
                            <li key={i}><div className="flex justify-between items-center"><span className="font-semibold">{to}</span><span className="font-bold text-red-600 dark:text-red-400">₹{amount.toFixed(2)}</span></div></li>
                        ))}
                    </ul>
                </div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">This is a simplified summary of how to settle all debts in the group with the minimum number of transactions.</p>
        </Modal>
    );
}

function SettleUpModal({ friends, onSave, onClose }) {
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [error, setError] = useState('');

    const handleSave = () => {
        if(!from || !to || !amount || parseFloat(amount) <= 0) {setError("Please fill all fields with valid values."); return; }
        if(from === to) { setError("'From' and 'To' cannot be the same person."); return; }
        setError('');
        onSave({ from, to, amount, date });
    }

    return (
        <Modal onClose={onClose} size="lg">
             <h2 className="text-2xl font-bold mb-6 flex items-center gap-2"><Send/> Record a Settlement</h2>
             {error && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4">{error}</div>}
             <div className="space-y-4">
                <div className="flex items-center gap-4"><select value={from} onChange={e => setFrom(e.target.value)} className="w-full p-3 bg-gray-100 dark:bg-gray-700 dark:border-gray-600 rounded-lg"><option value="">Payer...</option>{friends.map(f=><option key={f} value={f}>{f}</option>)}</select><span className="font-semibold">paid</span><select value={to} onChange={e => setTo(e.target.value)} className="w-full p-3 bg-gray-100 dark:bg-gray-700 dark:border-gray-600 rounded-lg"><option value="">Payee...</option>{friends.map(f=><option key={f} value={f}>{f}</option>)}</select></div>
                 <div className="flex items-center gap-4"><input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} className="w-1/2 p-3 bg-gray-100 dark:bg-gray-700 dark:border-gray-600 rounded-lg"/><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-1/2 p-3 bg-gray-100 dark:bg-gray-700 dark:border-gray-600 rounded-lg"/></div>
             </div>
             <div className="flex justify-end gap-4 mt-8"><button onClick={onClose} className="px-6 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg">Cancel</button><button onClick={handleSave} className="px-6 py-2 bg-green-600 text-white font-semibold rounded-lg flex items-center gap-2"><Save/> Save Settlement</button></div>
        </Modal>
    );
}

function ExpenseFormModal({ friends, expense, onSave, onClose }) {
    const [description, setDescription] = useState('');
    const [totalAmount, setTotalAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [paidBy, setPaidBy] = useState({});
    const [splitType, setSplitType] = useState('equally');
    const [splitters, setSplitters] = useState(() => friends.reduce((acc, f) => ({...acc, [f]: true }), {}));
    const [splitPercentages, setSplitPercentages] = useState({});
    const [isRecurring, setIsRecurring] = useState(false);
    const [dayOfMonth, setDayOfMonth] = useState(1);
    const [formError, setFormError] = useState('');

    useEffect(() => {
        if (expense) {
            setDescription(expense.description); setTotalAmount(expense.totalAmount);
            setDate(expense.date.toDate().toISOString().slice(0,10)); setSplitType(expense.splitType);
            setPaidBy(expense.paidBy.reduce((acc, p) => ({...acc, [p.friend]: p.amount }), {}));
            if(expense.splitType === 'equally') setSplitters(friends.reduce((acc, f) => ({...acc, [f]: expense.splits.some(s => s.friend === f)}), {}));
            else setSplitPercentages(expense.splits.reduce((acc, s) => ({...acc, [s.friend]: s.percentage}), {}));
        }
    }, [expense, friends]);
    
    const paidByTotal = useMemo(() => Object.values(paidBy).reduce((sum, val) => sum + (parseFloat(val) || 0), 0), [paidBy]);
    const percentageTotal = useMemo(() => Object.values(splitPercentages).reduce((sum, val) => sum + (parseFloat(val) || 0), 0), [splitPercentages]);

    const handleSave = () => {
        const parsedAmount = parseFloat(totalAmount);
        if (!description || !parsedAmount || parsedAmount <= 0) { setFormError("Description and a valid positive amount are required."); return; }
        if (Math.abs(paidByTotal - parsedAmount) > 0.01) { setFormError(`Payments (₹${paidByTotal.toFixed(2)}) must add up to the total amount (₹${parsedAmount.toFixed(2)}).`); return; }
        let splits;
        if(splitType === 'equally') {
            const activeSplitters = Object.entries(splitters).filter(([,v]) => v).map(([k]) => k);
            if (activeSplitters.length === 0) { setFormError("At least one person must be selected to split the bill."); return; }
            splits = activeSplitters.map(friend => ({ friend }));
        } else {
             if (Math.abs(percentageTotal - 100) > 0.1) { setFormError("Percentages must add up to 100%."); return; }
             splits = Object.entries(splitPercentages).filter(([,p]) => parseFloat(p) > 0).map(([friend, percentage]) => ({ friend, percentage: parseFloat(percentage) }));
        }
        if(isRecurring && (dayOfMonth < 1 || dayOfMonth > 28)) { setFormError("Recurring day must be between 1 and 28."); return; }
        onSave({ description, totalAmount: parsedAmount, date, splitType, paidBy: Object.entries(paidBy).filter(([,a]) => parseFloat(a) > 0).map(([friend, amount]) => ({ friend, amount: parseFloat(amount) })), splits }, isRecurring, dayOfMonth);
    };

    return (
        <Modal onClose={onClose}>
            <h2 className="text-2xl font-bold mb-6">{expense ? 'Edit Expense' : 'Add New Expense'}</h2>
            {formError && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4">{formError}</div>}
            <div className="space-y-6">
                <input type="text" placeholder="Description (e.g., Groceries)" value={description} onChange={e => setDescription(e.target.value)} className="w-full p-3 bg-gray-100 dark:bg-gray-700 dark:border-gray-600 rounded-lg"/>
                <div className="flex gap-4">
                    <input type="number" placeholder="Total Amount" value={totalAmount} onChange={e => setTotalAmount(e.target.value)} className="w-1/2 p-3 bg-gray-100 dark:bg-gray-700 dark:border-gray-600 rounded-lg"/>
                    <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-1/2 p-3 bg-gray-100 dark:bg-gray-700 dark:border-gray-600 rounded-lg" disabled={isRecurring}/>
                </div>
                {!expense && (
                    <div className="flex items-center gap-4 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg">
                        <input type="checkbox" id="isRecurring" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"/>
                        <label htmlFor="isRecurring" className="font-semibold flex items-center gap-1"><Repeat size={16}/> Make this a recurring monthly payment</label>
                        {isRecurring && (<div className="flex items-center gap-2"><span>on day</span> <input type="number" min="1" max="28" value={dayOfMonth} onChange={e=>setDayOfMonth(parseInt(e.target.value))} className="w-16 p-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-md"/></div>)}
                    </div>
                )}
                <div>
                    <h3 className="font-semibold text-lg mb-2 flex items-center gap-2"><DollarSign/>Paid By</h3>
                    <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg grid grid-cols-2 gap-4 max-h-48 overflow-y-auto">
                        {friends.map(friend => (
                            <div key={friend} className="flex items-center gap-2">
                                <label className="flex-1 text-sm">{friend}</label>
                                <input type="number" placeholder="0.00" value={paidBy[friend] || ''} onChange={e => setPaidBy({...paidBy, [friend]: e.target.value})} className="w-24 p-2 bg-white dark:bg-gray-600 border dark:border-gray-500 rounded-md text-sm"/>
                            </div>
                        ))}
                    </div>
                    <div className={`text-right mt-2 text-sm font-semibold ${Math.abs(paidByTotal - (parseFloat(totalAmount) || 0)) > 0.01 ? 'text-red-500' : 'text-green-500'}`}>Total Paid: ₹{paidByTotal.toFixed(2)}</div>
                </div>
                <div>
                    <h3 className="font-semibold text-lg mb-2 flex items-center gap-2"><Users/>Split Bill</h3>
                    <div className="flex gap-2 mb-4 rounded-lg bg-gray-100 dark:bg-gray-700 p-1">
                        <button onClick={() => setSplitType('equally')} className={`flex-1 p-2 rounded-md text-sm font-semibold transition ${splitType === 'equally' ? 'bg-white dark:bg-gray-600 shadow' : ''}`}>Equally</button>
                        <button onClick={() => setSplitType('percentage')} className={`flex-1 p-2 rounded-md text-sm font-semibold transition ${splitType === 'percentage' ? 'bg-white dark:bg-gray-600 shadow' : ''}`}>By Percentage</button>
                    </div>
                    <div className="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg grid grid-cols-2 gap-4 max-h-48 overflow-y-auto">
                        {splitType === 'equally' ? (
                            friends.map(friend => (
                                <div key={friend} className="flex items-center gap-3">
                                    <input type="checkbox" id={`split-${friend}`} checked={splitters[friend] || false} onChange={e => setSplitters({...splitters, [friend]: e.target.checked})} className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"/>
                                    <label htmlFor={`split-${friend}`} className="text-sm">{friend}</label>
                                </div>
                            ))
                        ) : (
                            friends.map(friend => (
                                <div key={friend} className="flex items-center gap-2">
                                    <label className="flex-1 text-sm">{friend}</label>
                                    <div className="flex items-center">
                                        <input type="number" placeholder="0" value={splitPercentages[friend] || ''} onChange={e => setSplitPercentages({...splitPercentages, [friend]: e.target.value})} className="w-20 p-2 bg-white dark:bg-gray-600 border dark:border-gray-500 rounded-md text-sm"/>
                                        <Percent size={16} className="text-gray-400 -ml-6"/>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    {splitType === 'percentage' && (
                        <div className={`text-right mt-2 text-sm font-semibold ${Math.abs(percentageTotal - 100) > 0.1 ? 'text-red-500' : 'text-green-500'}`}>Total: {percentageTotal.toFixed(0)}%</div>
                    )}
                </div>
            </div>
            <div className="flex justify-end gap-4 mt-8">
                <button onClick={onClose} className="px-6 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg">Cancel</button>
                <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg flex items-center gap-2"><Save/> {expense ? 'Save Changes' : 'Add Expense'}</button>
            </div>
        </Modal>
    );
}
