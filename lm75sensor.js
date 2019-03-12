#!/usr/bin/env node

const os = require('os');
const MQTT = require('mqtt');
const i2c = require('i2c-bus');

const LOGGING_LEVELS = {
  FATAL: 0,
  ERROR: 1,
  DEBUG: 3,
  INFO: 2
};

const APPLICATION_START_TIMEOUT = 5 * 1000; // XXX: Wait HCI devices on system startup
const CMD_READ_TEMP = 0x0;

const APP_STATE_RUNNING = 'running';
const APP_STATE_STOPPING = 'stopping';


let dataTransmissionTaskId = null;

let applicationState = APP_STATE_RUNNING;

let mqttClient = null;
let config = {};

// Commons
// ==========

const loadConfig = () => {
  const c = require('./config');
  return c;
};

const log = (msg, data = '', level = LOGGING_LEVELS.DEBUG) => {
  const appLoggingLevel = LOGGING_LEVELS[config.app.loggingLevel];
  if (level <= LOGGING_LEVELS.ERROR) {
    console.error(msg, data);
  }
  else if (level <= appLoggingLevel) {
    console.log(`${msg}`, data);
  }
};

// Broker Utils
// ==========
const brokerDisconnect = () => {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }
};

const brokerConnect = (mqttConfig) => {
  const mqttAddr = `${mqttConfig.host}:${mqttConfig.port}`;
  log(`Connecting to: ${mqttAddr}`);

  const connectionProblemsHandler = (err) => {
    if (err) {
      log('Connection problem, disconnecting ...', err, LOGGING_LEVELS.ERROR);
    }
  };
  log('new MQTT client creation ...');
  mqttClient = MQTT.connect({
    protocol: 'mqtt',
    host: mqttConfig.host,
    port: mqttConfig.port,
    reconnecting: true
  });

  mqttClient.on('connect', () => {
    log(`Successfully connected to: ${mqttAddr}`, '', LOGGING_LEVELS.INFO);
  });

  mqttClient.on('close', connectionProblemsHandler);
  mqttClient.on('error', connectionProblemsHandler);
  mqttClient.on('end', connectionProblemsHandler);
  mqttClient.on('offline', connectionProblemsHandler);
};

const toCelsius = (rawTemp) => {
  const halfDegrees = ((rawTemp & 0x7f) << 1) + (rawTemp >> 15);

  if ((halfDegrees & 0x100) === 0) {
    return halfDegrees / 2; // Temp +ve
  }

  return -((~halfDegrees & 0xff) / 2); // Temp -ve
};

function getserial() {

   var serial = null; 
   var fs = require('fs');
   var content = fs.readFileSync('/proc/cpuinfo', 'utf8');
   var cont_array = content.split("\n");
   var serial_line = cont_array.filter(data => {
            return data.indexOf('Serial') === 0
   });

   if (serial_line.length > 0) {
      serial = serial_line[0].split(":")[1];
   }
   
   return serial;
} 



const sendSensor1Info = (appConfig) => {
  const lm75 = appConfig.lm75;
  const i2c1 = i2c.openSync(lm75.bus_num);
  const rawTemp = i2c1.readWordSync(lm75.sensor1, CMD_READ_TEMP);

  console.log( 'LM75(1) Temp (%): ' + toCelsius(rawTemp) );
  const msg = JSON.stringify({
		tpid: getserial(),
		message: "iot-gw/lm75/sensor1Topic",
		timestamp: Math.round((new Date()).getTime() / 1000),
		sensor1_desc: "Lm75_temperature near Memory",
		sensor1_temp:  toCelsius(rawTemp)
  });

  mqttClient.publish("lm75/sensor1Topic", msg);
  //mqttClient.publish(lm75.sensor1Topic, msg);
  log(`Publish to Lm75Info ${msg}`);
  i2c1.closeSync();

};

const sendSensor2Info = (appConfig) => {
  const lm75 = appConfig.lm75;
  const i2c1 = i2c.openSync(lm75.bus_num);
  const rawTemp = i2c1.readWordSync(lm75.sensor2, CMD_READ_TEMP);

  console.log( 'LM75(2) Temp (%): ' +  toCelsius(rawTemp) );
  const msg = JSON.stringify({
		tpid: getserial(),
		message: "iot-gw/lm75/sensor2Topic",
		timestamp: Math.round((new Date()).getTime() / 1000),
		sensor2_desc: "Lm75_temperature near Cpu",
		sensor2_temp:  toCelsius(rawTemp)
  });

  mqttClient.publish("lm75/sensor2topic", msg);
  //mqttClient.publish(lm75.sensor2topic, msg);
  log(`Publish to Lm75Info ${msg}`);
  i2c1.closeSync();

};

const startSendingTask = (appConfig) => {
  log('Start Sending Task ...');
  return setInterval(() => {
    if (mqttClient) {
        sendSensor1Info(appConfig);
        sendSensor2Info(appConfig);      
    }
  }, appConfig.app.sendInterval);
};

const stopSendingTask = () => {
  log('Stop Sending Task ...');
  clearInterval(dataTransmissionTaskId);
};

// App Utils
// ==========

const start = (appConfig) => {
  log('Starting with Config: ', appConfig, LOGGING_LEVELS.INFO);

  brokerConnect(appConfig.mqtt);
  dataTransmissionTaskId = startSendingTask(appConfig);
};

const stop = () => {
  if (applicationState === APP_STATE_STOPPING) return;
  applicationState = APP_STATE_STOPPING;
  log('Stopping ...');
  stopSendingTask();
  brokerDisconnect();
};

const init = () => {
  config = loadConfig();
  log('Initialize ...');
  // Set exit handlers
  process.on('exit', () => {
    stop();
  });
  process.on('uncaughtException', (err) => {
    log('uncaughtException:', err, LOGGING_LEVELS.FATAL);
    try {
      stop();
    }
    catch (stopErr) {
      log('Error while stop:', stopErr, LOGGING_LEVELS.FATAL);
    }
    finally {
      process.exit(-1);
    }
  });
  return config;
};

// Application
// ==========
init();
setTimeout(() => {
  start(config);
}, APPLICATION_START_TIMEOUT);

