const Bobaos = require("bobaos");
const EE = require("events");

const datapoints = require("./datapointsRedis");
const SI = require("./serverItemsRedis");

const config = require("../config");

let BobaosSdk = params => {
  let self = new EE();

  // default params
  let serialPortDevice = config.sdk.serialport.device;
  let defaultSerialPortParams = config.sdk.serialport.params;
  let _params = {
    serialPort: { device: serialPortDevice, params: defaultSerialPortParams },
    debug: false
  };
  Object.assign(_params, params);

  // to resolve promise when `reset` request is sent.
  let _resolveReset = null;

  let _bobaos = new Bobaos(_params);
  _bobaos.on("open", async _ => {
    console.log("Serialport opened");
    await SI.clearServerItems();
    await datapoints.clearAllDatapoints();
    await self._loadServerItems();
    await self._loadDatapoints();

    // if reset was triggered by request, resolve request promise
    if (typeof _resolveReset === "function") {
      // resolve promise then clear resolve function
      _resolveReset();
      _resolveReset = null;
    }
  });

  // listen to reset event
  _bobaos.on("reset", _ => {
    console.log("Reset event from baos.");
    self._onResetEventFromBaos();
  });
  _bobaos.on("error", e => {
    console.log(`Error  with bobaos core module ${e.message}.`);
    self.emit("error", e);
  });

  // listen to indication events
  _bobaos.on("DatapointValue.Ind", data => {
    if (Array.isArray(data)) {
      data.forEach(async v => {
        let { id, value } = v;
        let result = await datapoints.processRawValue(id, value);
        self.emit("datapoint value", result);
      });
    }
  });

  _bobaos.on("ServerItem.Ind", async payload => {
    await Promise.all(
      payload.map(async t => {
        let { id, value } = t;
        let item = await SI.processValue(id, value);
        self.emit("server item", item);
      })
    );
  });

  // datapoint storage to get dpt info
  // get all datapoints description, save it to store
  // disable/enable notifications before/after descr receive
  self._loadDatapoints = async _ => {
    console.log("Loading datapoints");
    console.log("Setting indications to false");
    await _bobaos.setServerItem(SI.ItemsEnum.IndicationSending, Buffer.alloc(1, 0x00));
    let buffItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
    let buff_size = Buffer.from(buffItem.raw, "base64").readUInt16BE(0);
    let number = Math.floor((buff_size - 6) / 5);
    await datapoints.clearAllDatapoints();
    await datapoints.initDatapoints();
    let _processDatapoint = d => {
      // push datapoint object to store
      return datapoints.pushDatapoint(d);
    };
    // now receive all configured datapoints
    let getDatapointDescrPromises = [];
    for (let i = 0; i < datapoints.MAX_DATAPOINTS_NUM; i += number) {
      if (datapoints.MAX_DATAPOINTS_NUM - i <= number) {
        number = datapoints.MAX_DATAPOINTS_NUM - i;
      }
      const prom = _bobaos
        .getDatapointDescription(i + 1, number)
        .then(chunk => {
          if (Array.isArray(chunk)) {
            return Promise.all(chunk.map(_processDatapoint));
          }
        })
        .then(_ => {
          console.log("Datapoint descriptions pushed to redis.");
        })
        .catch(e => {
          // e => undefined to ignore rejects like "no element found"
          return undefined;
        });
      getDatapointDescrPromises.push(prom);
    }

    await Promise.all(getDatapointDescrPromises);
    console.log(`All datapoints [${await datapoints.getDatapointsCount()}] loaded`);

    console.log(`Return indications to true`);
    try {
      await _bobaos.setServerItem(SI.ItemsEnum.IndicationSending, Buffer.alloc(1, 0x01));
    } catch (e) {
      console.log("Error while returning indications to true: ", e.message);
    }

    // bobaos SDK ready. Emitting event
    self.emit("ready");
  };

  self._loadServerItems = async (start = 1, number = 17) => {
    console.log("Loading server items");
    let payload = await _bobaos.getServerItem(start, number);
    await Promise.all(
      payload.map(async t => {
        let { id, value } = t;
        await SI.processValue(id, value);
      })
    );
    console.log("Server items loaded");
  };

  self._onResetEventFromBaos = async _ => {
    self.emit("stop");
    console.log("Reset event from baos.");
    await self.reset();
    self.emit("reset");
  };

  // sdk func
  self.reset = _ => {
    return new Promise((resolve, reject) => {
      self.emit("stop");
      console.log("Resetting SDK.");
      // should be used after bobaos commit
      // https://github.com/bobaos/bobaos/commit/c3ebccb929f1819c3685a1a53cc419a3e32c0c24
      _bobaos.closeSerialPort(async err => {
        if (err) {
          reject(err);
        }
        console.log("Serialport closed");
        _bobaos.openSerialPort();
        _resolveReset = resolve;
      });
    });
  };

  // parameter byte
  self.getParameterByte = async id => {
    // get few parameter bytes
    if (Array.isArray(id)) {
      id.forEach(t => {
        if (typeof t !== "number") {
          throw new TypeError(`Parameter byte id in payload array is not a number.`);
        }
      });
      let promises = id.map(i => _bobaos.getParameterByte(i));
      return (await Promise.all(promises)).map(r => r.readUInt8(0));
    }

    if (typeof id === "number") {
      return self.getParameterByte([id]);
    }

    throw new TypeError("Wrong payload type. Should be number or array of numbers.");
  };

  // sdk func
  // server items
  self.getServerItem = async payload => {
    if (payload === null) {
      let items = await _bobaos.getServerItem(1, 17);
      await Promise.all(
        items.map(async t => {
          let { id, value } = t;
          await SI.processValue(id, value);
        })
      );

      return await SI.getAllItems();
    }
    if (Array.isArray(payload)) {
      payload.forEach(async it => {
        let items = await _bobaos.getServerItem(it, 1);
        await Promise.all(
          items.map(async t => {
            let { id, value } = t;
            await SI.processValue(id, value);
          })
        );
        if (typeof it !== "number") {
          throw new TypeError(`Server item id in payload is not a number.`);
        }
      });
      return await Promise.all(payload.map(SI.getServerItem));
    }

    if (typeof payload === "number") {
      let items = await _bobaos.getServerItem(payload, 1);
      await Promise.all(
        items.map(async t => {
          let { id, value } = t;
          await SI.processValue(id, value);
        })
      );

      return await SI.getServerItem(payload);
    }

    throw new TypeError("Wrong payload type. Should be number or array of numbers.");
  };

  // programming mode
  self.setProgrammingMode = async value => {
    let id = SI.ItemsEnum.ProgrammingMode;
    let raw = Buffer.alloc(1, 0x00);
    if (value) {
      raw.writeUInt8(0x01, 0);
    }

    await _bobaos.setServerItem(id, raw);

    return await self.getServerItem(id);
  };
  self.getProgrammingMode = async _ => {
    return await self.getServerItem(SI.ItemsEnum.ProgrammingMode);
  };

  // datapoint funcs
  self.getDescription = async id => {
    if (id === null) {
      return await datapoints.getAllDescriptions();
    }
    if (Array.isArray(id)) {
      id.forEach((t, index) => {
        if (typeof t !== "number") {
          throw new TypeError(`Datapoint id in payload array is not a number.`);
        }
        if (id < 1 || id > datapoints.MAX_DATAPOINTS_NUM) {
          throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}.`);
        }
      });
      return await Promise.all(
        id.map(async i => {
          return await datapoints.getDescription(i);
        })
      );
    }

    if (typeof id === "number") {
      return await datapoints.getDescription(id);
    }

    throw new TypeError("Payload should be null for all dps or array of numbers.");
  };

  self.setValue = async payload => {
    if (Array.isArray(payload)) {
      payload.forEach(t => {
        let itemHasId = Object.prototype.hasOwnProperty.call(t, "id");
        let itemHasValue = Object.prototype.hasOwnProperty.call(t, "value");
        let itemHasRaw = Object.prototype.hasOwnProperty.call(t, "raw");
        if (!itemHasId) {
          throw new Error(`Value item should have "id" field.`);
        }
        if (!(itemHasValue || itemHasRaw)) {
          throw new Error(`Value item should have "value" or "raw" field.`);
        }
        if (itemHasRaw) {
          if (typeof t.raw !== "string") {
            throw new TypeError("Raw value should be base64 encoded buffer");
          }
        }
        let { id } = t;
        if (typeof id !== "number") {
          throw new TypeError(`Datapoint id should be a number.`);
        }
        if (id < 1 || id > datapoints.MAX_DATAPOINTS_NUM) {
          throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}.`);
        }
      });

      // set multiple values
      let rawValues = await Promise.all(
        payload.map(async v => {
          let itemHasValue = Object.prototype.hasOwnProperty.call(v, "value");
          let itemHasRaw = Object.prototype.hasOwnProperty.call(v, "raw");

          // value field has higher priority
          if (itemHasValue) {
            let { id, value } = v;
            let buff = await datapoints.convert2raw(id, value);

            return { id: id, value: buff };
          }
          if (itemHasRaw) {
            let { id, raw } = v;
            let buff = Buffer.from(raw, "base64");

            return { id: id, value: buff };
          }
        })
      );

      await _bobaos.setMultipleValues(rawValues);

      return self.getValue(payload.map(v => v.id));
    }

    if (typeof payload === "object") {
      return self.setValue([payload]);
    }

    throw new TypeError(`Wrong payload for "set value" method. Should be object {id: id, value: value} or array.`);
  };

  self.getValue = async id => {
    // if we want to receive multiple values
    if (Array.isArray(id)) {
      id.forEach((item, index) => {
        if (typeof item !== "number") {
          throw new TypeError(`Datapoint id should be a number.`);
        }
      });
      id.sort((a, b) => {
        return parseInt(a) - parseInt(b);
      });

      // make sure that datapoint id is only one in array
      let idUniq = [];
      id.forEach(function(item, index) {
        if (idUniq.indexOf(item) < 0) {
          idUniq.push(item);
        }
      });

      // create idUniq copy to work with
      let idUniqCopy = idUniq.slice();

      // vars are used to calculate maximum count of datapoints to get
      let buffItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
      let bufferSizeUInt = Buffer.from(buffItem.raw, "base64").readUInt16BE(0);
      // header: 0xf0, 0x06, start[2], number[2]
      let headerSize = 6;
      let maxResLen = bufferSizeUInt - headerSize;
      // default 250 - 6 = 244

      // now process datapoint array and write to map
      // {start, number} objects to cover all id array
      let map = [];

      // get first element, calculate maximum number parameter count
      // write to map, delete all covered datapoints from array
      // so, if all datapoints are covered idUniq will be empty
      while (idUniq.length > 0) {
        let start = idUniq[0];
        let current = start;
        let number = 0;

        if (start < 1 || start > datapoints.MAX_DATAPOINTS_NUM) {
          throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}.`);
        }

        let currentResLen = 0;

        let currentMap;

        // situations:
        // len exceed, array end reached, maximum datapoint number reached
        while (true) {
          // calculate number of maximum possible covered datapoints

          // check if datapoint number is exceeded
          if (current > datapoints.MAX_DATAPOINTS_NUM) {
            // current datapoint is not in array, so
            current = current - 1;
            // add map to array, break loop
            // let number = current - start;
            number = current - start + 1;

            currentMap = { start: start, number: number, buffSize: currentResLen };
            break;
          }

          // get description for item, get  data length
          let item = await datapoints.getStoredDescription(current);
          let currentItemHeaderLen = 4;
          let currentItemDataLen = 1;
          if (item) {
            currentItemDataLen = parseInt(item.length);
          }

          // calculate response len
          let currentItemResLen = currentItemHeaderLen + currentItemDataLen;
          if (currentResLen + currentItemResLen < maxResLen) {
            // add to length, process next
            currentResLen += currentItemResLen;
            current = current + 1;
          } else {
            // current datapoint doesn't fit buffer len, so
            current = current - 1;
            // add map to array, break loop
            // let number = current - start;
            number = current - start + 1;

            currentMap = { start: start, number: number, buffSize: currentResLen };
            break;
          }
        }

        // take a look at id array and delete covered elements
        let j = 0;

        let covered = 0;
        let cnumber = 0;

        while (idUniq[j]) {
          if (idUniq[j] < start + number) {
            // cnumber(covered number) is parameter
            // to pass to _bobaos.getDatapointValue(start, cnumber)
            cnumber = idUniq[j] - start + 1;
            covered += 1;
            j += 1;
          } else {
            break;
          }
        }

        currentMap.cnumber = cnumber;
        currentMap.covered = covered;

        map.push(currentMap);
        idUniq.splice(0, covered);
      }

      // restore idUniq
      idUniq = idUniqCopy.slice();

      let valuesAll = await Promise.all(
        map.map(m => {
          return _bobaos.getDatapointValue(m.start, m.cnumber, 0);
        })
      );

      let valuesFlat = [];
      valuesAll.forEach(t => {
        valuesFlat = valuesFlat.concat(t);
      });

      let filterIds = t => {
        if (t) {
          if (typeof t.id !== "undefined") {
            return idUniq.includes(parseInt(t.id));
          }
        } else {
          return false;
        }
      };
      let values = valuesFlat.filter(filterIds);
      let result = await datapoints.processRawValues(values);

      result = result.filter(t => {
        return typeof t !== "undefined";
      });

      return result;
    }

    if (typeof id === "number") {
      // just for one datapoint
      if (id < 1 || id > datapoints.MAX_DATAPOINTS_NUM) {
        throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}.`);
      }
      let payload = await _bobaos.getDatapointValue(id, 1);

      let result = await Promise.all(payload.map(d => datapoints.processRawValue(d.id, d.value)));

      // for one datapoint
      if (result.length === 1) {
        return result[0];
      }

      return result;
    }

    throw new TypeError(`Wrong datapoint id type. Should be number or array of numbers.`);
  };

  self.getStoredValue = async id => {
    // if we want to receive multiple datapoints
    if (Array.isArray(id)) {
      let result = [];

      // catch errors
      id.forEach(t => {
        if (typeof t !== "number") {
          throw new TypeError("Wrong datapoint id type. Should be number or array of numbers.");
        }
        if (id < 1 || id > datapoints.MAX_DATAPOINTS_NUM) {
          throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}.`);
        }
      });

      // now filter datapoints that don't have stored value yet
      // stored ids is array of id values of which
      let storedIds = [];
      let storedValues = [];
      // new ids is array of id with unknown values
      let newIds = [];

      await Promise.all(
        id.map(async d => {
          let datapoint = await datapoints.getStoredDescription(d);
          if (datapoint) {
            // if value already has been received
            if (Object.prototype.hasOwnProperty.call(datapoint, "value")) {
              let { raw, value } = datapoint;
              storedIds.push(d);
              let _res = { id: d, value: value, raw: raw };
              storedValues.push(_res);
              return;
            }

            return newIds.push(d);
          }
        })
      );

      let newValues = [];
      if (newIds.length > 0) {
        newValues = await self.getValue(newIds);
      }

      result = storedValues.concat(newValues);

      // for one datapoint return object, not array
      if (result.length === 1) {
        return result[0];
      }

      return result;
    }

    // just for one datapoint
    if (typeof id === "number") {
      return self.getStoredValue([id]);
    }

    throw new TypeError("Wrong datapoint id type. Should be number or array of numbers.");
  };

  // get values of all configured datapoints
  self.pollValues = async _ => {
    let descriptions = await datapoints.getAllStoredDescriptions();
    let valid = descriptions.filter(t => t.valid);
    let id = valid.map(t => t.id);

    return self.getValue(id);
  };

  self.readValue = async id => {
    if (typeof id === "number") {
      return self.readValue([id]);
    }
    if (Array.isArray(id)) {
      id.forEach(t => {
        if (typeof t !== "number") {
          throw new TypeError("Datapoint id should be a number.");
        }
        if (id < 1 || id > datapoints.MAX_DATAPOINTS_NUM) {
          throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}.`);
        }
      });
      let ids = await Promise.all(
        id.map(async (i, index) => {
          let { length } = await datapoints.getStoredDescription(i);

          return { id: JSON.parse(i), length: JSON.parse(length) };
        })
      );

      return _bobaos.readMultipleDatapoints(ids);
    }

    throw new TypeError(`Wrong datapoint id type. Should be number or array of numbers.`);
  };

  return self;
};

module.exports = BobaosSdk;
