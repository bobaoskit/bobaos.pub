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

  let _bobaos = new Bobaos(_params);
  _bobaos.on("open", async _ => {
    console.log("Serialport opened");
    await self._loadServerItems();
    await self._loadDatapoints();
    // DONE: load server items, load datapoints
  });
  // listen to reset event
  _bobaos.on("reset", _ => {
    console.log("Reset event from baos.");
    self.reset();
  });
  _bobaos.on("error", e => {
    console.log(`Error  with bobaos core module ${e.message}`);
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
  // DONE: get all datapoints description, save it to store
  // DONE: disable/enable notifications before/after descr receive
  self._loadDatapoints = async _ => {
    console.log("Loading datapoints");
    console.log("Setting indications to false");
    await _bobaos.setServerItem(SI.ItemsEnum.IndicationSending, Buffer.alloc(1, 0x00));
    // let buff_size = (await _bobaos.getServerItem(SI.ItemsEnum.CurrentBufferSize, 1))[0].value.readUInt16BE(0);
    let buffItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
    let buff_size = Buffer.from(buffItem.raw, "base64").readUInt16BE(0);
    let number = Math.floor((buff_size - 6) / 5);
    // let i = 1;
    await datapoints.clearAllDatapoints();
    await datapoints.initDatapoints();
    let _processDatapoint = d => {
      // push datapoint object to store
      return datapoints.pushDatapoint(d);
    };
    // now receive all programmed datapoints
    let getDatapointDescrPromises = [];
    for (let i = 0; i < datapoints.MAX_DATAPOINTS_NUM; i += number) {
      if (datapoints.MAX_DATAPOINTS_NUM - i <= number) {
        number = datapoints.MAX_DATAPOINTS_NUM - i;
      }
      getDatapointDescrPromises.push(_bobaos.getDatapointDescription(i + 1, number));
    }

    // e => undefined to ignore rejects like "no element found"
    let dps = await Promise.all(getDatapointDescrPromises.map(p => p.catch(e => undefined)));
    // now process all of them and write to the store
    dps.forEach(async chunk => {
      if (Array.isArray(chunk)) {
        await Promise.all(chunk.map(_processDatapoint));
      }
    });
    console.log(`All datapoints [${await datapoints.getDatapointsCount()}] loaded`);
    console.log(`Return indications to true`);
    await _bobaos.setServerItem(SI.ItemsEnum.IndicationSending, Buffer.alloc(1, 0x01));
    // TODO: get bus connected state
    console.log("Bobaos SDK ready. Emitting event");
    self.emit("ready");
  };
  self._loadServerItems = async (start = 1, number = 17) => {
    console.log("Loading server items");
    let payload = await _bobaos.getServerItem(start, number);
    payload.forEach(t => {
      let { id, value } = t;
      SI.processValue(id, value);
    });
    console.log("Server items loaded");
  };

  // sdk func
  self.reset = async _ => {
    self.emit("stop");
    console.log("Resetting SDK.");
    await SI.clearServerItems();
    await datapoints.clearAllDatapoints();
    await self._loadServerItems();
    await self._loadDatapoints();
  };

  // parameter byte
  self.getParameterByte = async id => {
    // get few parameter bytes
    if (Array.isArray(id)) {
      id.forEach(t => {
        if (typeof t !== "number") {
          throw new TypeError(`Parameter byte id "${t}" at position ${index} in payload array is not a number.`);
        }
      });
      let promises = id.map(i => _bobaos.getParameterByte(i));
      return (await Promise.all(promises)).map(r => r.readUInt8(0));
    }

    if (typeof id === "number") {
      return (await _bobaos.getParameterByte(id)).readUInt8(0);
    }

    throw new TypeError("Wrong payload type. Should be number or array of numbers.");
  };
  // sdk func
  // server items

  self.getServerItem = async payload => {
    if (payload === null) {
      return await SI.getAllItems();
    }
    if (Array.isArray(payload)) {
      payload.forEach(t => {
        if (typeof t !== "number") {
          throw new TypeError(`Server item id "${t}" at position ${index} in payload array is not a number.`);
        }
      });
      return await Promise.all(payload.map(SI.getServerItem));
    }

    if (typeof payload === "number") {
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
          throw new TypeError(`Id "${t}" at position ${index} in payload array is not a number.`);
        }
        if (id < 1 || id > datapoints.MAX_DATAPOINTS_NUM) {
          throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}`);
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
      // set multiple values
      let rawValues = await Promise.all(
        payload.map(async v => {
          let { id, value } = v;
          let raw = await datapoints.convert2raw(id, value);

          return { id: id, value: raw };
        })
      );

      // TODO: after set datapoints, get values and write to the store
      await _bobaos.setMultipleValues(rawValues);

      return self.getValue(payload.map(v => v.id));
    }
    let payloadHasId = Object.prototype.hasOwnProperty.call(payload, "id");
    let payloadHasValue = Object.prototype.hasOwnProperty.call(payload, "value");
    if (!payloadHasId || !payloadHasValue) {
      throw new TypeError("Please specify payload as object or array of objects {id: <num>, value: <value>}");
    }
    let { id, value } = payload;
    let rawValue = await datapoints.convert2raw(id, value);

    await _bobaos.setDatapointValue(id, rawValue);

    // TODO: after set datapoint, get value and write to the store
    return self.getValue(id);
  };

  self.getValue = async id => {
    // if we want to receive multiple values
    if (Array.isArray(id)) {
      id.forEach((item, index) => {
        if (typeof item !== "number") {
          throw new TypeError(`Wrong datapoint id in array. Item: ${item}; index: ${index}.`);
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

      // if we got datapoints
      // let bufferSizeServerItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
      // let bufferSizeRaw = Buffer.from(bufferSizeServerItem.raw, "base64");
      // let bufferSizeUInt = bufferSizeRaw.readUInt16BE(0);
      //let bufferSizeUInt = (await _bobaos.getServerItem(SI.ItemsEnum.CurrentBufferSize, 1))[0].value.readUInt16BE(0);
      let buffItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
      let bufferSizeUInt = Buffer.from(buffItem.raw, "base64").readUInt16BE(0);
      // header: 0xf0, 0x06, start[2], number[2]
      let headerSize = 6;
      let maxResLen = bufferSizeUInt - headerSize;

      // default 250 - 6 = 244

      // now we process each datapoint and write to map
      // {start, number}
      // map will cover all datapoints
      let map = [];

      let i = 0;
      let imax = idUniq.length;
      while (i < imax) {
        let start = idUniq[i];

        if (isNaN(start)) {
          throw new Error(`Cannot get datapoint id from array at index ${i}`);
        }

        if (start < 0 || start > datapoints.MAX_DATAPOINTS_NUM) {
          throw new RangeError(`Datapoint id should be in range ${0}-${datapoints.MAX_DATAPOINTS_NUM}`);
        }

        let j = 0;
        let jmax = 50;
        if (start + jmax > datapoints.MAX_DATAPOINTS_NUM) {
          jmax = datapoints.MAX_DATAPOINTS_NUM - start + 1;
        }

        let currentResLen = 0;
        while (j < jmax) {
          let current = start + j;
          let item = await datapoints.getDescription(current);
          let currentItemHeaderLen = 4;
          let currentItemDataLen = 1;
          if (item) {
            currentItemDataLen = parseInt(item.length);
          }

          let currentItemResLen = currentItemHeaderLen + currentItemDataLen;
          //
          if (currentResLen + currentItemResLen < maxResLen) {
            // add to length, process next
            currentResLen += currentItemResLen;
          } else {
            // add map to array, break j loop
            let number = current - start;
            let currentMap = { start: start, number: number, buffSize: currentResLen };
            map.push(currentMap);

            i += 1;
            break;
          }

          // break on last datapoint
          if (current === datapoints.MAX_DATAPOINTS_NUM) {
            let number = current - start + 1;
            let currentMap = { start: start, number: number, buffSize: currentResLen };
            map.push(currentMap);

            i += 1;
            break;
          }
          // ************************ //

          j += 1;
          current += 1;
          let index = idUniq.findIndex(t => parseInt(t) === current);
          if (index > -1) {
            i = index;
          }
        }
      }

      // old
      // let getValues = id.map(i => _bobaos.getDatapointValue(i));
      // let values = await Promise.all(getValues);

      let valuesAll = await Promise.all(
        map.map(m => {
          return _bobaos.getDatapointValue(m.start, m.number, 0);
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
      // let result = await Promise.all(
      //   values.map(v => {
      //     return datapoints.processRawValue(v.id, v.value).catch(e => undefined);
      //   })
      // );

      result = result.filter(t => {
        return typeof t !== "undefined";
      });

      return result;
    }

    if (typeof id === "number") {
      // just for one datapoint
      if (id < 1 || id > datapoints.MAX_DATAPOINTS_NUM) {
        throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}`);
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
          throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}`);
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

  self.pollValues = async _ => {
    let descriptions = await datapoints.getAllStoredDescriptions();
    // sort datapoints by id

    let i = 0;
    let imax = datapoints.MAX_DATAPOINTS_NUM;

    // if we got datapoints
    // let bufferSizeServerItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
    // let bufferSizeRaw = Buffer.from(bufferSizeServerItem.raw, "base64");
    // let bufferSizeUInt = bufferSizeRaw.readUInt16BE(0);
    // let bufferSizeUInt = (await _bobaos.getServerItem(SI.ItemsEnum.CurrentBufferSize, 1))[0].value.readUInt16BE(0);
    let buffItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
    let bufferSizeUInt = Buffer.from(buffItem.raw, "base64").readUInt16BE(0);
    // header: 0xf0, 0x06, start[2], number[2]
    let headerSize = 6;
    let maxResLen = bufferSizeUInt - headerSize;
    // now we process each datapoint and write to map
    // {start, number}
    // map will cover all datapoints
    let map = [];
    let start = i + 1;

    let currentResLen = 0;
    // calculate response len to be sure it is less or eq than maxDataLength
    while (i < imax) {
      // current datapoint and its length
      let id = i + 1;
      const findById = t => parseInt(t.id) === id;
      let item = descriptions.find(findById);

      // How much bytes response exactly for this datapoint
      // id[2] state[1] length[1]
      let currentItemHeaderLen = 4;
      let currentItemDataLen = 1;

      // default filter is 0x00 - get all datapoint values
      // it returns datapoint value even if datapoint was not configured in ETS
      // so, if datapoint doesn't exists, it's length = 1
      if (item) {
        currentItemDataLen = parseInt(item.length);
      }

      let currentItemResLen = currentItemHeaderLen + currentItemDataLen;
      // compare with max response length
      if (currentResLen + currentItemResLen < maxResLen) {
        currentResLen += currentItemResLen;
      } else {
        // push
        let number = id - start;
        let currentMap = { start: start, number: number, buffSize: currentResLen };
        map.push(currentMap);

        // reset vars
        start = id;
        const findStart = t => parseInt(t.id) === start;
        let startItem = descriptions.find(findStart);
        let startItemHeaderLen = 4;
        let startItemDataLen = 1;
        if (startItem) {
          startItemDataLen = parseInt(startItem.length);
        }

        currentResLen = startItemHeaderLen + startItemDataLen;
      }

      // last item
      if (id === imax) {
        // push
        let number = id - start + 1;
        let currentMap = { start: start, number: number, buffSize: currentResLen };
        map.push(currentMap);
        break;
      }

      i++;
    }

    // number = parseInt(descriptions[imax - 1].id) - start;
    let valuesAll = await Promise.all(
      map.map(m => {
        return _bobaos.getDatapointValue(m.start, m.number, 0);
      })
    );

    let values = [];
    valuesAll.forEach(t => {
      values = values.concat(t);
    });

    return await datapoints.processRawValues(
      values.filter(v => {
        return typeof v === "object";
      })
    );
  };

  self.readValue = async id => {
    if (typeof id === "number") {
      return self.readValue([id]);
    }
    if (Array.isArray(id)) {
      let ids = await Promise.all(
        id.map(async (i, index) => {
          if (typeof i === "number") {
            if (id < 1 || id > datapoints.MAX_DATAPOINTS_NUM) {
              throw new RangeError(`Datapoint id should be in range ${1}-${datapoints.MAX_DATAPOINTS_NUM}`);
            }
            let { length } = await datapoints.getStoredDescription(i);

            return { id: JSON.parse(i), length: JSON.parse(length) };
          }

          throw new TypeError(`Wrong datapoint id: "${i}" at index: ${index}`);
        })
      );

      return _bobaos.readMultipleDatapoints(ids);
    }

    throw new TypeError(`Wrong datapoint id type. Should be number or array of numbers.`);
  };

  return self;
};

module.exports = BobaosSdk;
