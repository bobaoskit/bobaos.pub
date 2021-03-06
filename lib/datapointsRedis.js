const Redis = require("redis");
const DPTS = require("knx-dpts-baos");
const config = require("../config.js");

const redisClient = Redis.createClient(config.ipc.redis);

const prefix = `${config.ipc.key_prefix}:datapoints`;

const MAX_DATAPOINTS_NUM = 1000;
let DPOINTS = [];

const DatapointsStoredHash = {};

for (let i = 0; i < MAX_DATAPOINTS_NUM; i += 1) {
  DPOINTS.push(i + 1);
}

const getDatapointsCount = _ => {
  return new Promise((resolve, reject) => {
    // return _datapoints.length;
    redisClient.keys(`${prefix}:*`, (err, res) => {
      if (err) {
        return reject(err);
      }

      const m = redisClient.multi();
      res.forEach(k => {
        m.hget(k, "valid");
      });
      m.exec((err, validValues) => {
        if (err) {
          return reject(err);
        }

        let result = validValues.filter(t => JSON.parse(t) === true);
        return resolve(result.length);
      });
    });
  });
};

const getDescription = id => {
  return new Promise((resolve, reject) => {
    let key = `${prefix}:${id}`;
    redisClient.hgetall(key, (err, result) => {
      if (err) {
        return reject(err);
      }

      return resolve(result);
    });
  });
};

const getStoredDescription = id => {
  let key = `${prefix}:${id}`;
  if (Object.prototype.hasOwnProperty.call(DatapointsStoredHash, key)) {
    return JSON.parse(JSON.stringify(DatapointsStoredHash[key]));
  }

  throw new RangeError(`Unknown datapoint ${id}`);
};

const getAllStoredDescriptions = _ => {
  return DPOINTS.map(id => {
    let key = `${prefix}:${id}`;

    return JSON.parse(JSON.stringify(DatapointsStoredHash[key]));
  });
};

const getAllDescriptions = _ => {
  const multi = redisClient.multi();
  DPOINTS.forEach(id => {
    let key = `${prefix}:${id}`;
    multi.hgetall(key);
  });

  return new Promise((resolve, reject) => {
    multi.exec((err, res) => {
      if (err) {
        return reject(err);
      }

      return resolve(res);
    });
  });
};

const clearAllDatapoints = _ => {
  const multi = redisClient.multi();
  DPOINTS.forEach(id => {
    let key = `${prefix}:${id}`;
    multi.del(key);
    delete DatapointsStoredHash[key];
  });

  return new Promise((resolve, reject) => {
    multi.exec((err, res) => {
      if (err) {
        return reject(err);
      }

      return resolve(res);
    });
  });
};

const processRawValue = (id, raw) => {
  return new Promise((resolve, reject) => {
    if (!Buffer.isBuffer(raw)) {
      throw new Error(`Raw value isn't instance of Buffer`);
    }
    // bobaos:datapoints:1
    let key = `${prefix}:${id}`;
    try {
      let descr = getStoredDescription(id);
      let { dpt } = descr;
      let jsValue = DPTS[dpt].toJS(raw);
      if (typeof jsValue === "object") {
        jsValue = JSON.stringify(jsValue);
      }

      DatapointsStoredHash[key].value = jsValue;
      DatapointsStoredHash[key].raw = raw.toString("base64");

      let obj2set = ["value", jsValue, "raw", raw.toString("base64")];

      redisClient.hmset(key, obj2set, (err, res) => {
        if (err) {
          return reject(err);
        }

        descr = getStoredDescription(id);
        resolve(descr);
      });
    } catch (e) {
      reject(e);
    }
  });
};
const processRawValues = values => {
  let multi = redisClient.multi();
  return new Promise((resolve, reject) => {
    if (!Array.isArray(values)) {
      reject(new Error("Values is not array"));
    }
    Promise.all(
      values.map(async v => {
        // bobaos:datapoints:1
        try {
          let id = v.id;
          let raw = v.value;
          let key = `${prefix}:${id}`;
          let descr = getStoredDescription(id);
          let { dpt } = descr;
          let jsValue = DPTS[dpt].toJS(raw);
          if (typeof jsValue === "object") {
            jsValue = JSON.stringify(jsValue);
          }

          DatapointsStoredHash[key].value = jsValue;
          DatapointsStoredHash[key].raw = raw.toString("base64");

          let obj2set = ["value", jsValue, "raw", raw.toString("base64")];

          multi.hmset(key, obj2set);

          return getStoredDescription(id);
        } catch (e) {
          reject(e);
        }
      })
    )
      .then(result => {
        multi.exec((err, res) => {
          if (err) {
            return reject(err);
          }

          resolve(result);
        });
      })
      .catch(reject);
  });
};

const convert2raw = (id, value) => {
  return new Promise((resolve, reject) => {
    let key = `${prefix}:${id}`;
    try {
      let descr = getStoredDescription(id);
      let { dpt } = descr;
      let raw = DPTS[dpt].fromJS(value);

      return resolve(raw);
    } catch (e) {
      reject(e);
    }
  });
};

const pushDatapoint = item => {
  return new Promise((resolve, reject) => {
    let { id, length, flags, dpt } = item;
    // process flags
    let flag_priority = flags.priority;
    let flag_communication = flags.communication;
    let flag_read = flags.read;
    let flag_write = flags.write;
    let flag_transmit = flags.transmit;
    let flag_readOnInit = flags.readOnInit;
    let flag_update = flags.update;
    let key = `${prefix}:${id}`;
    let obj = [
      "valid",
      true,
      "id",
      id,
      "length",
      length,
      "dpt",
      dpt,
      "flag_priority",
      flag_priority,
      "flag_communication",
      flag_communication,
      "flag_read",
      flag_read,
      "flag_write",
      flag_write,
      "flag_transmit",
      flag_transmit,
      "flag_readOnInit",
      flag_readOnInit,
      "flag_update",
      flag_update
    ];
    DatapointsStoredHash[key] = {
      id: id,
      length: length,
      dpt: dpt,
      valid: true,
      flag_priority: flag_priority,
      flag_communication: flag_communication,
      flag_read: flag_read,
      flag_write: flag_write,
      flag_transmit: flag_transmit,
      flag_readOnInit: flag_readOnInit,
      flag_update: flag_update
    };
    redisClient.hmset(key, obj, (err, res) => {
      if (err) {
        return reject(err);
      }

      return resolve(res);
    });
  });
};

const initDatapoints = _ => {
  const multi = redisClient.multi();
  DPOINTS.forEach(id => {
    let length = 1;
    let dpt = "dpt1";
    let key = `${prefix}:${id}`;
    let flag_priority = "low";
    let flag_communication = false;
    let flag_read = false;
    let flag_write = false;
    let flag_transmit = false;
    let flag_readOnInit = false;
    let flag_update = false;
    let obj2set = [
      "valid",
      false,
      "id",
      id,
      "length",
      length,
      "dpt",
      dpt,
      "flag_priority",
      flag_priority,
      "flag_communication",
      flag_communication,
      "flag_read",
      flag_read,
      "flag_write",
      "flag_transmit",
      flag_transmit,
      flag_write,
      "flag_readOnInit",
      flag_readOnInit,
      "flag_update",
      flag_update
    ];
    multi.hmset(key, obj2set);
    DatapointsStoredHash[key] = {
      id: id,
      length: length,
      dpt: dpt,
      valid: false,
      flag_priority: flag_priority,
      flag_communication: flag_communication,
      flag_read: flag_read,
      flag_write: flag_write,
      flag_transmit: flag_transmit,
      flag_readOnInit: flag_readOnInit,
      flag_update: flag_update
    };
  });

  return new Promise((resolve, reject) => {
    multi.exec((err, res) => {
      if (err) {
        return reject(err);
      }

      resolve(res);
    });
  });
};

module.exports = {
  MAX_DATAPOINTS_NUM: MAX_DATAPOINTS_NUM,
  DatapointsStoredHash: DatapointsStoredHash,
  getStoredDescription: getStoredDescription,
  getAllStoredDescriptions: getAllStoredDescriptions,
  initDatapoints: initDatapoints,
  pushDatapoint: pushDatapoint,
  convert2raw: convert2raw,
  processRawValue: processRawValue,
  processRawValues: processRawValues,
  clearAllDatapoints: clearAllDatapoints,
  getAllDescriptions: getAllDescriptions,
  getDescription: getDescription,
  getDatapointsCount: getDatapointsCount
};
