const DPTS = require("knx-dpts-baos");
const Redis = require("redis");

const config = require("../config.json");

const redisClient = Redis.createClient(config.ipc.redis);

const prefix = `${config.ipc.key_prefix}:datapoint`;

// TODO: move to Redis database
//
//
const _datapoints = [];
const _descriptions = [];
const MAX_DATAPOINTS_NUM = 1000;
_datapoints.length = MAX_DATAPOINTS_NUM;

const getLength = cb => {
  // return _datapoints.length;
  redisClient.keys(`${prefix}:*`, (err, res) => {
    if (err) {
      return cb(err);
    }

    cb(null, res.length);
  });
};

const getAllDescriptions = cb => {
  redisClient.keys(`${prefix}:*`, async (err, res) => {
    if (err) {
      return cb(err);
    }

    let _getDescription = key => {
      return new Promise((resolve, reject) => {
        redisClient.hgetall(key, (err, result) => {
          if (err) {
            return reject(err);
          }

          return resolve(result);
        });
      });
    };
    let descrs = await Promise.all(res.map(_getDescription).map(p => p.catch(e => undefined)));
    cb(null, descrs);
  });
};

const clearDatapoints = _ => {
  for (let i = 1; i <= MAX_DATAPOINTS_NUM; i += 1) {
    let key = `${prefix}:${i}`;
    redisClient.del(key, (err, res) => {
      if (err) {
        return;
      }
    });
  }
};

const pushDatapoint = item => {
  // old way:
  // _datapoints.push(item);
  // now store as big array
  _descriptions[item.id] = Object.assign({}, item);
  _datapoints[item.id] = Object.assign({ value: null, raw: null }, item);
};

const findDescriptionById = id => {
  let datapoint = _descriptions.slice(id, id + 1)[0];
  if (datapoint) {
    return datapoint;
  }
  throw new RangeError(`Cannot find datapoint with id ${id}`);
};

const findDatapointById = id => {
  // old way:
  // let findById = t => t.id === id;
  // let datapoint = _datapoints.find(findById);
  // new way
  let datapoint = _datapoints.slice(id, id + 1)[0];
  if (datapoint) {
    return datapoint;
  }
  throw new RangeError(`Cannot find datapoint with id ${id}`);
};

const checkDPT = dpt => {
  if (Object.prototype.hasOwnProperty.call(DPTS, dpt)) {
    return true;
  }
  throw new RangeError(`Cannot find dpt in knx-dpts-baos: "${dpt}"`);
};

const processRawValue = (id, value) => {
  let index = id;
  let { dpt } = _datapoints[index];
  checkDPT(dpt);
  if (!Buffer.isBuffer(value)) {
    throw new Error(`Raw value isn't instance of Buffer`);
  }

  let rawValue = value.slice();
  let jsValue = DPTS[dpt].toJS(value);
  _datapoints[index].raw = rawValue;
  _datapoints[index].value = jsValue;

  return {
    id: id,
    raw: rawValue,
    value: jsValue
  };
};

// const convertDpt2js = (id, value) => {
//   let datapoint = findDatapointById(id);
//   let { dpt } = datapoint;
//   checkDPT(dpt);
//   if (!Buffer.isBuffer(value)) {
//     throw new Error(`Raw value isn't instance of Buffer`);
//   }
//
//   return DPTS[dpt].toJS(value);
// };

const convertDpt2raw = (id, value) => {
  let datapoint = findDatapointById(id);
  let { dpt } = datapoint;
  checkDPT(dpt);

  return DPTS[dpt].fromJS(value);
};

module.exports = {
  getLength: getLength,
  clear: clearDatapoints,
  push: pushDatapoint,
  convert2raw: convertDpt2raw,
  findById: findDatapointById,
  processRawValue: processRawValue,
  findDescriptionById: findDescriptionById,
  getAllDescriptions: getAllDescriptions
};
