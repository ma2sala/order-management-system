require('dotenv').config();
const http = require('http');
const createApp = require('./app');
const { initSocket } = require('./socket');

const app = createApp();
const httpServer = http.createServer(app); // shared server so Express + Socket.io use one port

initSocket(httpServer);

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`\n  Order Management System running:`);
  console.log(`  → API:     http://localhost:${PORT}/api`);
  console.log(`  → Waiter:  http://localhost:${PORT}/waiter/`);
  console.log(`  → Barista: http://localhost:${PORT}/barista/`);
  console.log(`  → Chef:    http://localhost:${PORT}/chef/`);
  console.log(`  → Manager: http://localhost:${PORT}/admin/`);
  console.log(`  → Manager: http://localhost:${PORT}/admin/\n`);
});
