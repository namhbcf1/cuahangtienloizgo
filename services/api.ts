import { User, Product, Shift, Transaction } from '../types';

const API_Base = '/api';

export const api = {
    // Users
    getUsers: async (): Promise<User[]> => {
        const res = await fetch(`${API_Base}/users`);
        if (!res.ok) throw new Error('Failed to fetch users');
        return res.json();
    },
    createUser: async (user: User): Promise<User> => {
        const res = await fetch(`${API_Base}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        return res.json();
    },
    updateUser: async (user: User): Promise<User> => {
        const res = await fetch(`${API_Base}/users/${user.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        return res.json();
    },
    deleteUser: async (id: string): Promise<void> => {
        await fetch(`${API_Base}/users/${id}`, { method: 'DELETE' });
    },

    // Products
    getProducts: async (): Promise<Product[]> => {
        const res = await fetch(`${API_Base}/products`);
        return res.json();
    },
    createProduct: async (product: Product): Promise<Product> => {
        const res = await fetch(`${API_Base}/products`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product)
        });
        return res.json();
    },
    updateProduct: async (product: Product): Promise<Product> => {
        const res = await fetch(`${API_Base}/products/${product.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(product)
        });
        return res.json();
    },

    // Shifts
    getShifts: async (): Promise<Shift[]> => {
        const res = await fetch(`${API_Base}/shifts`);
        return res.json();
    },
    createShift: async (shift: Shift): Promise<Shift> => {
        const res = await fetch(`${API_Base}/shifts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(shift)
        });
        return res.json();
    },
    updateShift: async (shift: Shift): Promise<Shift> => {
        const res = await fetch(`${API_Base}/shifts/${shift.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(shift)
        });
        return res.json();
    },

    // Transactions
    getTransactions: async (): Promise<Transaction[]> => {
        const res = await fetch(`${API_Base}/transactions`);
        return res.json();
    },
    createTransaction: async (transaction: Transaction): Promise<Transaction> => {
        const res = await fetch(`${API_Base}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(transaction)
        });
        return res.json();
    }
};
