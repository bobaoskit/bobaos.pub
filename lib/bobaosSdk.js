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
    let buff_size = Buffer.from((await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize)).raw, "base64");
    let number = Math.floor((buff_size - 6) / 5);
    let i = 1;
    await datapoints.clearAllDatapoints();
    await datapoints.initDatapoints();
    let _processDatapoint = async d => {
      // push datapoint object to store
      await datapoints.pushDatapoint(d);
    };
    // now receive all programmed datapoints
    let getDatapointDescrPromises = [];
    for (let i = 0, imax = datapoints.MAX_DATAPOINTS_NUM; i < imax; i += number) {
      if (imax - i <= number) {
        number = imax - i;
      }
      getDatapointDescrPromises.push(_bobaos.getDatapointDescription(i + 1, number));
    }
    // e => undefined to ignore rejects like "no element found"
    let dps = await Promise.all(getDatapointDescrPromises.map(p => p.catch(e => undefined)));
    // now process all of them and write to the store
    dps.forEach(chunk => {
      if (Array.isArray(chunk)) {
        chunk.forEach(_processDatapoint);
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
      let promises = id.map(i => _bobaos.getParameterByte(i).catch(e => undefined));
      return (await Promise.all(promises)).map(r => r.readUInt8(0));
    }

    return (await _bobaos.getParameterByte(id)).readUInt8(0);
  };
  // sdk func
  // server items

  self.getServerItem = async payload => {
    if (payload === null) {
      return await SI.getAllItems();
    }
    if (Array.isArray(payload)) {
      return await Promise.all(payload.map(SI.getServerItem));
    }

    return await SI.getServerItem(payload);
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
      return await Promise.all(
        id.map(async i => {
          return await datapoints.getDescription(i);
        })
      );
    }

    if (typeof id === "number") {
      return await datapoints.getDescription(id);
    }

    throw new Error("getDatapoints parameter should be null for all dps or array of numbers.");
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
      throw new Error("Please specify payload as object or array of objects {id: <num>, value: <value>}");
    }
    let { id, value } = payload;
    let rawValue = await datapoints.convert2raw(id, value);

    await _bobaos.setDatapointValue(id, rawValue);

    // TODO: after set datapoint, get value and write to the store
    return self.getValue(id);
  };

  self.getValue = async id => {
    // if we want to receive multiple values
    let _descriptions = await datapoints.getAllDescriptions();
    let _getDescription = _id => {
      return new Promise((resolve, reject) => {
        let _descr = _descriptions.find(t => {
          return parseInt(t.id) === parseInt(_id);
        });
      });
    };
    if (Array.isArray(id)) {
      id.sort((a, b) => {
        return parseInt(a) - parseInt(b);
      });

      // make sure that datapoint id is only one in array
      let idUniq = [];
      id.forEach(function(item) {
        if (idUniq.indexOf(item) < 0) {
          idUniq.push(item);
        }
      });

      // if we got datapoints
      // let bufferSizeServerItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
      // let bufferSizeRaw = Buffer.from(bufferSizeServerItem.raw, "base64");
      // let bufferSizeUInt = bufferSizeRaw.readUInt16BE(0);
      //let bufferSizeUInt = (await _bobaos.getServerItem(SI.ItemsEnum.CurrentBufferSize, 1))[0].value.readUInt16BE(0);
      let bufferSizeUInt = Buffer.from((await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize)).raw, "base64");
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

        let j = 0;
        let jmax = 50;
        if (start + jmax > datapoints.MAX_DATAPOINTS_NUM) {
          jmax = datapoints.MAX_DATAPOINTS_NUM - start + 1;
        }

        let currentResLen = 0;
        while (j < jmax) {
          let current = start + j;
          let item = await _getDescription(current);
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
          return _bobaos.getDatapointValue(m.start, m.number, 0).catch(e => undefined);
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
      let result = await Promise.all(
        values.map(v => {
          return datapoints.processRawValue(v.id, v.value).catch(e => undefined);
        })
      );

      result = result.filter(t => {
        return typeof t !== "undefined";
      });
      return result;
    }

    // just for one datapoint
    let payload = await _bobaos.getDatapointValue(id, 1);

    let result = await Promise.all(payload.map(d => datapoints.processRawValue(d.id, d.value)));

    // for one datapoint
    if (result.length === 1) {
      return result[0];
    }

    return result;
  };

  self.getStoredValue = async id => {
    // if we want to receive multiple datapoints
    if (Array.isArray(id)) {
      let result = [];
      await Promise.all(
        id.map(async d => {
          let datapoint = await datapoints.getDescription(d);
          if (datapoint) {
            let { value, raw } = datapoint;
            // if value is not yet received
            if (!value) {
              result.push(await self.getValue(d));

              return;
            }

            let _res = { id: d, value: value, raw: raw };
            result.push(_res);
          }
        })
      );

      return result;
    }

    // just for one datapoint
    let datapoint = await datapoints.getDescription(id);
    let { value, raw } = datapoint;
    // if value is not yet received
    if (!value) {
      return self.getValue(id);
    }

    return { id: id, value: value, raw: raw };
  };

  self.pollValues = async _ => {
    let descriptions = await datapoints.getAllDescriptions();
    // sort datapoints by id
    descriptions.sort((a, b) => {
      return parseInt(a.id) - parseInt(b.id);
    });

    let i = 0;
    let imax = datapoints.MAX_DATAPOINTS_NUM;

    // if we got datapoints
    // let bufferSizeServerItem = await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize);
    // let bufferSizeRaw = Buffer.from(bufferSizeServerItem.raw, "base64");
    // let bufferSizeUInt = bufferSizeRaw.readUInt16BE(0);
    // let bufferSizeUInt = (await _bobaos.getServerItem(SI.ItemsEnum.CurrentBufferSize, 1))[0].value.readUInt16BE(0);
    let bufferSizeUInt = Buffer.from((await SI.getServerItem(SI.ItemsEnum.CurrentBufferSize)).raw, "base64");
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
        return _bobaos.getDatapointValue(m.start, m.number, 0).catch(e => undefined);
      })
    );

    let values = [];
    valuesAll.forEach(t => {
      values = values.concat(t);
    });

    let result = await Promise.all(
      values.map(v => {
        return datapoints.processRawValue(v.id, v.value).catch(e => undefined);
      })
    );

    result = result.filter(t => {
      return typeof t !== "undefined";
    });
    return result;

    // let values = await Promise.all(
    //   map.map(m => {
    //     return _bobaos.getDatapointValue(m.start, m.number, 0);
    //   })
    // );
    // let result = await Promise.all(
    //   values.map(v => {
    //     return datapoints.processRawValue(v.id, v.value).catch(e => undefined);
    //   })
    // );

    // result = result.filter(t => {
    //   return typeof t !== "undefined";
    // });
    // return result;
  };

  self.readValue = async id => {
    if (typeof id === "number") {
      let { length } = await datapoints.getDescription(id);

      return _bobaos.readDatapointFromBus(JSON.parse(id), JSON.parse(length));
    }
    if (Array.isArray(id)) {
      // TODO: get length of datapoints
      let ids = await Promise.all(
        id.map(async i => {
          let { length } = await datapoints.getDescription(i);

          return { id: JSON.parse(i), length: JSON.parse(length) };
        })
      );

      return _bobaos.readMultipleDatapoints(ids);
    }

    throw new TypeError("Please specify id arg as a single number or array of numbers");
  };

  return self;
};

module.exports = BobaosSdk;
