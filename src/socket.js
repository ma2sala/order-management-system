const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { verifyActiveUser } = require('./middleware/auth');

let io; // module-level reference so controllers can emit without a circular import

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN || '*' },
  });

  // Authenticate every socket connection using the same JWT as HTTP requests
  // (plus the same still-active check as HTTP requests — see
  // middleware/auth.js)
  io.use(async (socket, next) => {
    let payload;
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Unauthorized: no token'));
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return next(new Error('Unauthorized: invalid token'));
    }
    try {
      const user = await verifyActiveUser(payload);
      if (!user) return next(new Error('Unauthorized: account no longer active'));
      socket.user = user; // { id, name, role } — current role, not the token's
      next();
    } catch (err) {
      console.error('socket auth lookup error:', err);
      next(new Error('Server error verifying login'));
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

// A deactivated account's screens that are already open get cut off now,
// not on their next reconnect. Their reconnect is then refused by the
// still-active check above, which the screens show as "login expired".
function disconnectUser(userId) {
  if (!io) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.user && socket.user.id === userId) socket.disconnect(true);
  }
}

module.exports = { initSocket, getIO, disconnectUser };
