const ServerItems = {
  HardwareType: 1,
  HardwareVersion: 2,
  FirmwareVersion: 3,
  KnxManufacturerCodeDev: 4,
  KnxManufacturerCodeApp: 5,
  EtsAppId: 6,
  EtsAppVersion: 7,
  SerialNumber: 8,
  TimeSinceReset: 9,
  BusConnectionState: 10,
  MaximumBufferSize: 11,
  DescStringLen: 12,
  BaudRate: 13,
  CurrentBufferSize: 14,
  ProgrammingMode: 15,
  ProtocolVersion: 16,
  IndicationSending: 17
};

const _buf2Arr = buf => {
  return Array.prototype.slice.call(buf);
};

// TODO: set server item, buffer value depends on item type

const processServerItem = s => {
  let { id, length, value } = s;
  let item = {};
  let baudrate = 0;
  switch (id) {
    case ServerItems.HardwareType:
      item = { id: id, name: "HardwareType", value: _buf2Arr(value) };
      break;
    case ServerItems.HardwareVersion:
      item = { id: id, name: "HardwareVersion", value: _buf2Arr(value) };
      break;
    case ServerItems.FirmwareVersion:
      item = { id: id, name: "FirmwareVersion", value: _buf2Arr(value) };
      break;
    case ServerItems.KnxManufacturerCodeDev:
      item = { id: id, name: "KnxManufacturerCodeDev", value: _buf2Arr(value) };
      break;
    case ServerItems.KnxManufacturerCodeApp:
      item = { id: id, name: "KnxManufacturerCodeApp", value: _buf2Arr(value) };
      break;
    case ServerItems.EtsAppId:
      item = { id: id, name: "EtsAppId", value: _buf2Arr(value) };
      break;
    case ServerItems.EtsAppVersion:
      item = { id: id, name: "EtsAppId", value: _buf2Arr(value) };
      break;
    case ServerItems.SerialNumber:
      item = { id: id, name: "SerialNumber", value: _buf2Arr(value) };
      break;
    case ServerItems.TimeSinceReset:
      item = { id: id, name: "TimeSinceReset", value: value.readUInt32BE(0) };
      break;
    case ServerItems.BusConnectionState:
      item = { id: id, name: "BusConnectionState", value: Boolean(value[0]) };
      break;
    case ServerItems.MaximumBufferSize:
      item = { id: id, name: "MaximumBufferSize", value: value.readUInt16BE(0) };
      break;
    case ServerItems.DescStringLen:
      item = { id: id, name: "DescStringLen", value: value.readUInt16BE(0) };
      break;
    case ServerItems.BaudRate:
      if (value.readUInt8(0) === 1) {
        baudrate = 19200;
      }
      if (value.readUInt8(0) === 2) {
        baudrate = 115200;
      }
      item = { id: id, name: "BaudRate", value: baudrate };
      break;
    case ServerItems.CurrentBufferSize:
      item = { id: id, name: "CurrentBufferSize", value: value.readUInt16BE(0) };
      break;
    case ServerItems.ProgrammingMode:
      item = { id: id, name: "ProgrammingMode", value: Boolean(value[0]) };
      break;
    case ServerItems.ProtocolVersion:
      item = { id: id, name: "ProtocolVersion", value: value.readUInt8(0) };
      break;
    case ServerItems.IndicationSending:
      item = { id: id, name: "IndicationSending", value: Boolean(value[0]) };
      break;
    default:
      item = { id: id, name: "Unknown item", value: value };
      break;
  }

  return item;
};

const _serverItems = [];

const clearItems = _ => {
  _serverItems.length = 0;
};

const pushItem = item => {
  _serverItems.push(item);
};

const updateItem = (index, item) => {
  _serverItems[index] = item;
};

const getNames = _ => {
  return _serverItems.map(t => t.name);
};

const getAllValues = _ => {
  return _serverItems.slice();
};

const getServerItemValueByName = name => {
  const findByName = t => t.name === name;
  let serverItemIndex = _serverItems.findIndex(findByName);
  if (serverItemIndex > -1) {
    return _serverItems[serverItemIndex].value;
  }
  throw new RangeError(`Unknown server item ${name}`);
};

const getServerItemIndexByName = name => {
  const findByName = t => t.name === name;
  let serverItemIndex = _serverItems.findIndex(findByName);
  if (serverItemIndex > -1) {
    return serverItemIndex;
  }
  throw new RangeError(`Unknown server item ${name}`);
};

const getServerItemIndexById = id => {
  const findById = t => t.id === id;
  let serverItemIndex = _serverItems.findIndex(findById);
  if (serverItemIndex > -1) {
    return serverItemIndex;
  }
  throw new RangeError(`Unknown server item ${id}`);
};

const findByName = name => {
  const findByName = t => t.name === name;
  let serverItem = _serverItems.find(findByName);
  if (serverItem) {
    return serverItem;
  }
  throw new RangeError(`Cannot find server item ${name}`);
};

const findById = id => {
  const findById = t => t.id === id;
  let serverItemIndex = _serverItems.findIndex(findById);
  if (serverItemIndex > -1) {
    return _serverItems[serverItemIndex];
  }
  throw new RangeError(`Unknown server item ${id}`);
};

module.exports = {
  ServerItems: ServerItems,
  clear: clearItems,
  push: pushItem,
  process: processServerItem,
  update: updateItem,
  getIndexById: getServerItemIndexById,
  getValueByName: getServerItemValueByName,
  getNames: getNames,
  getAllValues: getAllValues,
  findByName: findByName,
  findById: findById
};
