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

// Estado global del servidor
const serverState = {
  connectedUsers: new Map(),
  mesas: new Map(),
  pedidosActivos: new Map()
};

// Inicializar mesas (ejemplo con 20 mesas)
for (let i = 1; i <= 20; i++) {
  serverState.mesas.set(i, {
    numero: i,
    ocupada: false,
    dispositivos: [],
    pedidoActivo: null,
    capacidad: 4,
    ubicacion: `Mesa ${i}`,
    estado: 'disponible'
  });
}

io.on('connection', (socket) => {
  console.log('🔌 Nueva conexión:', socket.id);
  
  let userData = null;
  let tipo = null;

  // Evento de identificación del usuario
  socket.on('identificarse', (data) => {
    userData = data;
    console.log('👤 Usuario identificado:', data);
    
    // Guardar información del usuario conectado
    serverState.connectedUsers.set(socket.id, {
      ...data,
      socketId: socket.id,
      connectedAt: new Date()
    });
    
    // Confirmar identificación
    socket.emit('identificado', {
      success: true,
      message: 'Usuario identificado correctamente',
      userData: data
    });
    
    // Enviar estado del servidor
    socket.emit('server-status', {
      connectedUsers: serverState.connectedUsers.size,
      activeTables: Array.from(serverState.mesas.values()).filter(m => m.ocupada).length,
      activePedidos: serverState.pedidosActivos.size
    });
  });

  // Registrar tipo de socket ("moso" o "caja") - compatibilidad con código anterior
  socket.on('registrar', (rol) => {
    tipo = rol;
    if (rol) {
      socket.join(rol);
    }
  });

  // Obtener estado actual de todas las mesas
  socket.on('obtener-estado-mesas', () => {
    const mesasArray = Array.from(serverState.mesas.values());
    socket.emit('estado-mesas', mesasArray);
    console.log('📋 Estado de mesas enviado a:', socket.id);
  });

  // Seleccionar mesa para hacer pedido
  socket.on('seleccionar-mesa', (data) => {
    const { mesa, dispositivo } = data;
    const mesaEstado = serverState.mesas.get(mesa);
    
    if (mesaEstado) {
      // Agregar dispositivo a la mesa si no está ya
      if (!mesaEstado.dispositivos.includes(dispositivo)) {
        mesaEstado.dispositivos.push(dispositivo);
      }
      
      mesaEstado.ocupada = true;
      mesaEstado.estado = 'ocupada';
      
      // Actualizar en el mapa
      serverState.mesas.set(mesa, mesaEstado);
      
      // Notificar a todos los clientes sobre el cambio
      io.emit('mesa-seleccionada', {
        mesa: mesa,
        dispositivo: dispositivo,
        mesaEstado: mesaEstado
      });
      
      // Emitir evento que el frontend escucha
      io.emit('mesa-estado-cambiado', {
        numero: mesa,
        ocupada: true,
        dispositivos: mesaEstado.dispositivos
      });
      
      // Enviar estado actualizado de mesas
      const mesasArray = Array.from(serverState.mesas.values());
      io.emit('estado-mesas', mesasArray);
      io.emit('estado-mesas-actualizado', mesasArray);
      
      console.log(`🪑 Mesa ${mesa} seleccionada por dispositivo ${dispositivo}`);
    } else {
      socket.emit('error-operacion', {
        mensaje: `Mesa ${mesa} no encontrada`,
        tipo: 'mesa_no_encontrada'
      });
    }
  });

  // Unirse a una sala específica
  socket.on('join-room', (room) => {
    socket.join(room);
    console.log(`🚪 Socket ${socket.id} se unió a la sala: ${room}`);
    socket.emit('joined-room', { room, success: true });
  });

  // Salir de una sala específica
  socket.on('leave-room', (room) => {
    socket.leave(room);
    console.log(`🚪 Socket ${socket.id} salió de la sala: ${room}`);
    socket.emit('left-room', { room, success: true });
  });

  // Evento emitido por un mozo al enviar un nuevo pedido
  socket.on('nuevoPedido', (data) => {
    if (tipo === 'moso') {
      io.to('caja').emit('nuevoPedido', data);
    }
    // También emitir a todos para sincronización general
    socket.broadcast.emit('nuevoPedido', data);
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
    console.log('🍽️ Nuevo pedido especial:', data);
  });

  // Evento para pagos realizados
  socket.on('pagoRealizado', (data) => {
    // Emitir a todos los clientes conectados excepto al emisor
    socket.broadcast.emit('pagoRealizado', data);
    console.log('💰 Pago realizado:', data);
  });

  // Evento para anulación de pedidos especiales
  socket.on('pedidoEspecialAnulado', (data) => {
    // Emitir a todos los clientes conectados excepto al emisor
    socket.broadcast.emit('pedidoEspecialAnulado', data);
    console.log('❌ Pedido especial anulado:', data);
  });

  // Crear nuevo pedido en mesa
  socket.on('crear-pedido-mesa', (data) => {
    const pedidoData = data.mesa ? data : { mesa: data.mesa, ...data };
    const mesa = pedidoData.mesa || data.mesa;
    const mesaEstado = serverState.mesas.get(mesa);
    
    if (mesaEstado) {
      // Crear el pedido con ID único
      const nuevoPedido = {
        id: `pedido_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        mesa: mesa,
        productos: pedidoData.productos || [],
        estado: 'pendiente',
        total: pedidoData.total || 0,
        timestamp: new Date(),
        dispositivo: pedidoData.dispositivo || socket.id
      };
      
      // Asignar pedido a la mesa
      mesaEstado.pedidoActivo = nuevoPedido;
      serverState.mesas.set(mesa, mesaEstado);
      
      // Guardar en pedidos activos
      serverState.pedidosActivos.set(nuevoPedido.id, nuevoPedido);
      
      // Notificar a todos los clientes con los eventos que el frontend espera
      io.emit('pedido-mesa-creado', {
        pedido: nuevoPedido,
        mesa: mesaEstado
      });
      
      // Emitir evento que el frontend escucha
      io.emit('pedido-creado', nuevoPedido);
      
      // Actualizar estado de mesas
      const mesasArray = Array.from(serverState.mesas.values());
      io.emit('estado-mesas-actualizado', mesasArray);
      
      console.log(`🍽️ Nuevo pedido creado para mesa ${mesa}:`, nuevoPedido.id);
    } else {
      socket.emit('error-operacion', {
        mensaje: `Mesa ${mesa} no encontrada`,
        tipo: 'mesa_no_encontrada'
      });
    }
  });

  // Actualizar estado de pedido
  socket.on('actualizar-estado-pedido', (data) => {
    const { pedidoId, estado: nuevoEstado } = data;
    const pedido = serverState.pedidosActivos.get(pedidoId);
    
    if (pedido) {
      const estadoAnterior = pedido.estado;
      pedido.estado = nuevoEstado;
      serverState.pedidosActivos.set(pedidoId, pedido);
      
      // Actualizar también en la mesa
      const mesaEstado = serverState.mesas.get(pedido.mesa);
      if (mesaEstado && mesaEstado.pedidoActivo && mesaEstado.pedidoActivo.id === pedidoId) {
        mesaEstado.pedidoActivo = pedido;
        serverState.mesas.set(pedido.mesa, mesaEstado);
      }
      
      // Notificar cambio de estado
      io.emit('estado-pedido-actualizado', {
        pedidoId,
        nuevoEstado,
        pedido
      });
      
      // Emitir evento que el frontend escucha
      io.emit('pedido-actualizado', pedido);
      
      // Emitir eventos específicos según el estado
      if (nuevoEstado === 'preparando' && estadoAnterior === 'pendiente') {
        io.emit('nuevo-pedido-cocina', pedido);
        console.log(`🍳 Pedido ${pedidoId} enviado a cocina`);
      } else if (nuevoEstado === 'listo' && estadoAnterior === 'preparando') {
        io.emit('pedido-listo-pago', pedido);
        console.log(`💰 Pedido ${pedidoId} listo para pago`);
      }
      
      console.log(`📝 Estado de pedido ${pedidoId} actualizado de ${estadoAnterior} a: ${nuevoEstado}`);
    } else {
      socket.emit('error-operacion', {
        mensaje: `Pedido ${pedidoId} no encontrado`,
        tipo: 'pedido_no_encontrado'
      });
    }
  });

  // Liberar mesa
  socket.on('liberar-mesa', (data) => {
    const { mesa, dispositivo } = data;
    const mesaEstado = serverState.mesas.get(mesa);
    
    if (mesaEstado) {
      // Remover dispositivo
      mesaEstado.dispositivos = mesaEstado.dispositivos.filter(d => d !== dispositivo);
      
      // Si no quedan dispositivos, liberar completamente la mesa
      if (mesaEstado.dispositivos.length === 0) {
        mesaEstado.ocupada = false;
        mesaEstado.estado = 'disponible';
        
        // Remover pedido activo si existe
        if (mesaEstado.pedidoActivo) {
          serverState.pedidosActivos.delete(mesaEstado.pedidoActivo.id);
          mesaEstado.pedidoActivo = null;
        }
      }
      
      serverState.mesas.set(mesa, mesaEstado);
      
      // Notificar liberación
      io.emit('mesa-liberada', {
        mesa,
        dispositivo,
        mesaEstado
      });
      
      // Emitir evento que el frontend escucha
      io.emit('mesa-estado-cambiado', {
        numero: mesa,
        ocupada: mesaEstado.ocupada,
        dispositivos: mesaEstado.dispositivos
      });
      
      // Actualizar estado de mesas
      const mesasArray = Array.from(serverState.mesas.values());
      io.emit('estado-mesas-actualizado', mesasArray);
      
      console.log(`🪑 Mesa ${mesa} liberada por dispositivo ${dispositivo}`);
    } else {
      socket.emit('error-operacion', {
        mensaje: `Mesa ${mesa} no encontrada`,
        tipo: 'mesa_no_encontrada'
      });
    }
  });
  
  // Agregar producto a pedido existente
  socket.on('agregar-producto-pedido', (data) => {
    const { pedidoId, producto } = data;
    const pedido = serverState.pedidosActivos.get(pedidoId);
    
    if (pedido) {
      // Agregar producto al pedido
      pedido.productos.push(producto);
      
      // Recalcular total si es necesario
      if (producto.precio) {
        pedido.total = (pedido.total || 0) + (producto.precio * (producto.cantidad || 1));
      }
      
      // Actualizar en el estado
      serverState.pedidosActivos.set(pedidoId, pedido);
      
      // Actualizar también en la mesa
      const mesaEstado = serverState.mesas.get(pedido.mesa);
      if (mesaEstado && mesaEstado.pedidoActivo && mesaEstado.pedidoActivo.id === pedidoId) {
        mesaEstado.pedidoActivo = pedido;
        serverState.mesas.set(pedido.mesa, mesaEstado);
      }
      
      // Notificar actualización del pedido
      io.emit('pedido-actualizado', pedido);
      
      console.log(`🍽️ Producto agregado al pedido ${pedidoId}:`, producto);
    } else {
      socket.emit('error-operacion', {
        mensaje: `Pedido ${pedidoId} no encontrado`,
        tipo: 'pedido_no_encontrado'
      });
    }
  });
  
  // Obtener pedidos por estado
  socket.on('obtener-pedidos-estado', (data) => {
    const { estado } = data;
    const pedidosFiltrados = Array.from(serverState.pedidosActivos.values())
      .filter(pedido => pedido.estado === estado);
    
    // Enviar pedidos filtrados al cliente que los solicitó
    socket.emit('pedidos-por-estado', {
      estado,
      pedidos: pedidosFiltrados
    });
    
    console.log(`📋 Enviados ${pedidosFiltrados.length} pedidos con estado '${estado}'`);
  });

  // Manejo de desconexión
  socket.on('disconnect', () => {
    console.log('🔌 Desconexión:', socket.id);
    
    // Remover usuario de la lista de conectados
    const user = serverState.connectedUsers.get(socket.id);
    if (user) {
      serverState.connectedUsers.delete(socket.id);
      console.log('👤 Usuario desconectado:', user);
    }
    
    // Limpiar de salas si tenía tipo
    if (tipo) {
      socket.leave(tipo);
    }
    
    // Remover dispositivo de todas las mesas
    for (const [mesaNum, mesaEstado] of serverState.mesas) {
      if (mesaEstado.dispositivos.includes(socket.id)) {
        mesaEstado.dispositivos = mesaEstado.dispositivos.filter(d => d !== socket.id);
        
        if (mesaEstado.dispositivos.length === 0) {
          mesaEstado.ocupada = false;
          mesaEstado.estado = 'disponible';
          if (mesaEstado.pedidoActivo) {
            serverState.pedidosActivos.delete(mesaEstado.pedidoActivo.id);
            mesaEstado.pedidoActivo = null;
          }
        }
        
        serverState.mesas.set(mesaNum, mesaEstado);
      }
    }
    
    // Notificar estado actualizado de mesas
    const mesasArray = Array.from(serverState.mesas.values());
    socket.broadcast.emit('estado-mesas', mesasArray);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor Socket.IO ejecutándose en puerto ${PORT}`);
  console.log(`📊 Estado inicial: ${serverState.mesas.size} mesas disponibles`);
});
