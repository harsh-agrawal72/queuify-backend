const socketIo = require('socket.io');
const Chat = require('../models/chat.model');

let io;
const onlinePresences = new Map(); // key (userId or orgId) -> Set of socket.ids
const socketToPresence = new Map(); // socket.id -> { key, type }

const registerPresence = (key, socketId, type) => {
    if (!onlinePresences.has(key)) {
        onlinePresences.set(key, new Set());
        // Broadcast presence change to all clients
        if (io) {
            io.emit('presence_change', { id: key, status: 'online', type });
        }
    }
    onlinePresences.get(key).add(socketId);
    socketToPresence.set(socketId, { key, type });
};

const removePresence = async (socketId) => {
    if (socketToPresence.has(socketId)) {
        const { key, type } = socketToPresence.get(socketId);
        const sockets = onlinePresences.get(key);
        if (sockets) {
            sockets.delete(socketId);
            if (sockets.size === 0) {
                onlinePresences.delete(key);
                const now = new Date();
                
                // Persist last seen in database (non-blocking)
                Chat.updateLastSeen(key, type, now).catch(err => {
                    console.error('Failed to update last seen in DB:', err.message);
                });

                // Broadcast presence change to all clients
                if (io) {
                    io.emit('presence_change', { 
                        id: key, 
                        status: 'offline', 
                        type, 
                        lastSeen: now.toISOString() 
                    });
                }
            }
        }
        socketToPresence.delete(socketId);
    }
};

const isOnline = (id) => onlinePresences.has(id);

const init = (httpServer) => {
    io = socketIo(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST']
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        connectTimeout: 45000
    });

    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // Join rooms for targeted updates
        socket.on('join_org', (orgId) => {
            socket.join(`org_${orgId}`);
            registerPresence(orgId, socket.id, 'org');
        });
        
        socket.on('join_service', (serviceId) => socket.join(`service_${serviceId}`));
        socket.on('join_resource', (resourceId) => socket.join(`resource_${resourceId}`));
        
        socket.on('join_user', (data) => {
            const userId = typeof data === 'object' ? data.userId : data;
            const role = typeof data === 'object' ? data.role : 'user';
            
            socket.join(`user_${userId}`);
            registerPresence(userId, socket.id, role);
            
            // Join role-specific broadcast rooms
            if (role === 'admin') {
                socket.join('admins');
                console.log(`Admin ${userId} joined 'admins' room`);
            } else {
                socket.join('users');
                console.log(`User ${userId} joined 'users' room`);
            }
        });

        // Chat Rooms
        socket.on('join_chat', (conversationId) => socket.join(`chat_${conversationId}`));
        socket.on('leave_chat', (conversationId) => socket.leave(`chat_${conversationId}`));
        socket.on('chat_typing', (data) => {
            // data = { conversationId, senderType, isTyping }
            socket.to(`chat_${data.conversationId}`).emit('chat_typing_update', data);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
            removePresence(socket.id);
        });
    });

    return io;
};

const getIO = () => {
    if (!io) throw new Error('Socket.io not initialized!');
    return io;
};

const emitQueueUpdate = (partitionKey, data) => {
    if (!io) return;
    // Emit to organization room (Admin Dashboard/Live Queue)
    io.to(`org_${partitionKey.orgId}`).emit('queue_update', data);
    
    // Targeted emits
    if (partitionKey.serviceId) io.to(`service_${partitionKey.serviceId}`).emit('queue_update', data);
    if (partitionKey.resourceId) io.to(`resource_${partitionKey.resourceId}`).emit('queue_update', data);
    if (partitionKey.userId) io.to(`user_${partitionKey.userId}`).emit('queue_update', data);
};

module.exports = {
    init,
    getIO,
    emitQueueUpdate,
    isOnline
};
