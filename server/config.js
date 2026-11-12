// Ajustes del negocio que puedes cambiar sin tocar el resto del código

// Hora a la que empieza cada turno (columna "Horario" de la tabla empleados)
const TURNOS = {
  matutino:   '08:00:00',
  vespertino: '17:00:00',
  nocturno:   '20:00:00'
};
const TURNO_POR_DEFECTO = '09:00:00';

// Minutos de tolerancia antes de marcar retardo
const TOLERANCIA_MIN = 10;

// Días antes de la caducidad para mostrar el aviso
const DIAS_AVISO_CADUCIDAD = 7;

module.exports = { TURNOS, TURNO_POR_DEFECTO, TOLERANCIA_MIN, DIAS_AVISO_CADUCIDAD };
