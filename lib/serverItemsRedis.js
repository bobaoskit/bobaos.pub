const Redis = require("redis");

const config = require("../config.json");

const redisClient = Redis.createClient(config.ipc.redis);

const prefix = `${config.ipc.key_prefix}:server_items`;

const ItemsEnum = {
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

const getServerItem = id => {
  return new Promise((resolve, reject) => {
    let key = `${prefix}`;
    let field = `${id}`;
    redisClient.hget(key, field, (err, result) => {
      if (err) {
        return reject(err);
      }

      if (typeof result === "string") {
        let formattedValue = Array.prototype.slice.call(Buffer.from(result, "base64"));
        return resolve({id: id, value: formattedValue, raw: result});
      } else {
        return reject(new Error(`Error getting server item with id ${id}`));
      }
    });
  });
};

const getAllItems = _ => {
  return new Promise((resolve, reject) => {
    let key = `${prefix}`;
    redisClient.hkeys(key, async (err, result) => {
      if (err) {
        return reject(err);
      }

      let obj2return = [];
      let values = await Promise.all(result.map(getServerItem));
      result.forEach((id, index) => {
        obj2return[`${id}`] = values[index];
      });

      resolve(values);
    });
  });
};

const clearServerItems = _ => {
  return new Promise((resolve, reject) => {
    let key = `${prefix}`;
    redisClient.del(key, (err, result) => {
      if (err) {
        return reject(err);
      }

      resolve(result);
    })
  });
};

const processValue = (id, raw) => {
  return new Promise((resolve, reject) => {
    if (!Buffer.isBuffer(raw)) {
      throw new Error(`Raw value isn't instance of Buffer`);
    }
    // bobaos:datapoints:1
    let key = `${prefix}`;
    let field = `${id}`;
    let obj2set = [field, raw.toString("base64")];
    redisClient.hmset(key, obj2set, async (err, res) => {
      if (err) {
        reject(err);
      }

      return resolve(await getServerItem(id));
    });
  });
};

module.exports = {
  ItemsEnum: ItemsEnum,
  getServerItem: getServerItem,
  getAllItems: getAllItems,
  clearServerItems: clearServerItems,
  processValue: processValue,
};