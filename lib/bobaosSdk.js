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
    serialPort: {device: serialPortDevice, params: defaultSerialPortParams},
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
        let {id, value} = v;
        let result = await datapoints.processRawValue(id, value);
        console.log("Update dpt store", id, result.value);
        self.emit("datapoint value", result);
      });
    }
  });

  _bobaos.on("ServerItem.Ind", payload => {
    payload.forEach(async t => {
      let {id, value} = t;
      let item = await SI.processValue(id, value);
      self.emit("server item", item);
    });
  });

  // datapoint storage to get dpt info
  // DONE: get all datapoints description, save it to store
  // DONE: disable/enable notifications before/after descr receive
  self._loadDatapoints = async _ => {
    console.log("Loading datapoints. Setting indication to false");
    await _bobaos.setServerItem(SI.ItemsEnum.IndicationSending, Buffer.alloc(1, 0x00));
    let buff_size = (await _bobaos.getServerItem(SI.ItemsEnum.CurrentBufferSize, 1))[0].value.readUInt16BE(0);
    let number = Math.floor((buff_size - 6) / 5);
    let i = 1;
    await datapoints.clearAllDatapoints();
    let _processDatapoint = async d => {
      // push datapoint object to store
      await datapoints.pushDatapoint(d);
    };
    // now receive all programmed datapoints
    let getDatapointDescrPromises = [];
    for (let i = 0, imax = 1000; i < imax; i += number) {
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
    console.log(`All datapoints [${await datapoints.getDatapointsCount()}] loaded. Return indications to true`);
    await _bobaos.setServerItem(SI.ItemsEnum.IndicationSending, Buffer.alloc(1, 0x01));
    // TODO: get bus connected state
    console.log("Bobaos SDK ready. Emitting event");
    self.emit("ready");
  };
  self._loadServerItems = async (start = 1, number = 17) => {
    console.log("Loading server items");
    let payload = await _bobaos.getServerItem(start, number);
    payload.forEach(t => {
      let {id, value} = t;
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

    let s = (await _bobaos.getServerItem(id))[0];
    await SI.processValue(id, s.value);
    return self.getServerItem(id);
  };
  self.getProgrammingMode = async value => {
    return self.getServerItem(SI.ItemsEnum.ProgrammingMode);
  };

  // datapoint funcs
  self.getDescription = async id => {
    if (id === null) {
      return await datapoints.getAllDescriptions();
    }
    if (Array.isArray(id)) {
      return await Promise.all(id.map(async i => {
        return await datapoints.getDescription(i)
      }));
    }

    if (typeof id === "number") {
      return await datapoints.getDescription(id);
    }

    throw new Error("getDatapoints parameter should be null for all dps or array of numbers.");
  };

  self.setValue = async payload => {
    if (Array.isArray(payload)) {
      // set multiple values
      let rawValues = await Promise.all(payload.map(async v => {
        let {id, value} = v;
        let raw = await datapoints.convert2raw(id, value);

        return {id: id, value: raw};
      }));

      console.log("raw values", rawValues);
      // TODO: after set datapoints, get values and write to the store
      await _bobaos.setMultipleValues(rawValues);

      return self.getValue(payload.map(v => v.id));
    }
    let payloadHasId = Object.prototype.hasOwnProperty.call(payload, "id");
    let payloadHasValue = Object.prototype.hasOwnProperty.call(payload, "value");
    if (!payloadHasId || !payloadHasValue) {
      throw new Error("Please specify payload as object or array of objects {id: <num>, value: <value>}");
    }
    let {id, value} = payload;
    let rawValue = await datapoints.convert2raw(id, value);

    await _bobaos.setDatapointValue(id, rawValue);

    // TODO: after set datapoint, get value and write to the store
    return self.getValue(id);
  };

  self.getValue = async id => {
    // if we want to receive multiple values
    if (Array.isArray(id)) {
      let getValues = id.map(i => _bobaos.getDatapointValue(i));
      let values = await Promise.all(getValues);

      let result = [];
      await Promise.all(values.map(async v => {
        let chunk = await Promise.all(v.map(async d => await datapoints.processRawValue(d.id, d.value)));
        result = result.concat(chunk);
      }));

      return result;
    }

    // just for one datapoint
    let payload = await _bobaos.getDatapointValue(id, 1);

    let result = await Promise.all(payload.map(async d => await datapoints.processRawValue(d.id, d.value)));

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
            let {value, raw} = datapoint;
            // if value is not yet received
            console.log("value, faw", value, raw);
            if (!value) {
              result.push(await self.getValue(d));

              return;
            }

            let _res = {id: (d), value: (value), raw: (raw)};
            result.push(_res);
            console.log(_res);
          }
        })
      );

      return result;
    }

    // just for one datapoint
    let datapoint = await datapoints.getDescription(id);
    let {value, raw} = datapoint;
    // if value is not yet received
    if (!value) {
      return self.getValue(id);
    }

    return {id: id, value: value, raw: raw};
  };

  self.readValue = async id => {
    if (typeof id === "number") {
      let {length} = await datapoints.getDescription(id);

      return _bobaos.readDatapointFromBus(id, length);
    }
    if (Array.isArray(id)) {
      // TODO: get length of datapoints
      let ids = await Promise.all(id.map(async i => {
        let {length} = await datapoints.getDescription(i);

        return {id: JSON.parse(i), length: JSON.parse(length)};
      }));

      return _bobaos.readMultipleDatapoints(ids);
    }

    throw new TypeError("Please specify id arg as a single number or array of numbers");
  };

  return self;
};

module.exports = BobaosSdk;
