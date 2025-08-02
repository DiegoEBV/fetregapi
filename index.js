const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

io.on('connection', (socket) => {
  let tipo = null;

  // Registrar tipo de socket ("moso" o "caja")
  socket.on('registrar', (rol) => {
    tipo = rol;
    if (rol) {
      socket.join(rol);
    }
  });

  // Evento emitido por un mozo al enviar un nuevo pedido
  socket.on('nuevoPedido', (data) => {
    if (tipo === 'moso') {
      io.to('caja').emit('nuevoPedido', data);
    }
  });

  // Evento emitido por caja al responder
  socket.on('respuestaCaja', (data) => {
    if (tipo === 'caja') {
      io.to('moso').emit('respuestaCaja', data);
    }
  });

  // Evento para nuevos pedidos especiales (para llevar y delivery)
  socket.on('nuevoPedidoEspecial', (data) => {
    // Emitir a todos los clientes conectados excepto al emisor
    socket.broadcast.emit('nuevoPedidoEspecial', data);
  });

  // Evento para pagos realizados
  socket.on('pagoRealizado', (data) => {
    // Emitir a todos los clientes conectados excepto al emisor
    socket.broadcast.emit('pagoRealizado', data);
  });

  // Evento para anulación de pedidos especiales
  socket.on('pedidoEspecialAnulado', (data) => {
    // Emitir a todos los clientes conectados excepto al emisor
    socket.broadcast.emit('pedidoEspecialAnulado', data);
  });
 
  
  socket.on('disconnect', () => {
    if (tipo) {
      socket.leave(tipo);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
