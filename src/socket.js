const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io; // module-level reference so controllers can emit without a circular import

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN || '*' },
  });

  // Authenticate every socket connection using the same JWT as HTTP requests
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Unauthorized: no token'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = payload; // { id, name, role }
      next();
    } catch (err) {
      next(new Error('Unauthorized: invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { id, role } = socket.user;

    // Room-based channels: baristas/managers share one room; each waiter
    // gets a private room scoped to their own id so status updates only
    // reach the waiter who owns that order.
    if (role === 'BARISTA' || role === 'MANAGER') {
      socket.join('barista_channel');
    }
    if (role === 'CHEF' || role === 'MANAGER') {
      socket.join('chef_channel');
    }
    if (role === 'CASHIER' || role === 'MANAGER') {
      socket.join('cashier_channel');
    }
    if (role === 'WAITER') {
      socket.join(`waiter_${id}`);
    }
    if (role === 'MANAGER') {
      socket.join('manager_channel');
    }
  });

  return io;
}

function getIO() {
  if (!io) throw new Error('Socket.io not initialized yet');
  return io;
}

module.exports = { initSocket, getIO };
