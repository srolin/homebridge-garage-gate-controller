var fs = require('fs');
var Service, Characteristic, DoorState; // set in the module.exports, from homebridge
var process = require('process');

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  DoorState = homebridge.hap.Characteristic.CurrentDoorState;

  homebridge.registerAccessory("homebridge-garage-gate-opener", "GarageGateOpener", GarageGateOpenerAccessory);
}

function getVal(config, key, defaultVal) {
    var val = config[key];
    if (val == null) {
        return defaultVal;
    }
    return val;
}

function GarageGateOpenerAccessory(log, config) {
  this.log = log;
  this.version = require('./package.json').version;
  log("GarageGateOpenerAccessory version " + this.version);

  if (process.geteuid() != 0) {
    log("WARN! WARN! WARN! may not be able to control GPIO pins because not running as root!");
  }

  this.name = config["name"];
  this.debug = getVal(config, "debug", false);
  this.doorSwitchPin = config["switchPin"];
  this.relayOn = getVal(config, "switchValue", 1);
  this.relayOff = 1-this.relayOn; //opposite of relayOn (O/1)
  this.doorSwitchPressTimeInMs = getVal(config, "switchPressTimeInMs", 1000);
  this.monitoringDoorState = false;
  this.closedDoorSensorPin = getVal(config, "closedSensorPin", config["doorSensorPin"]);
  this.openDoorSensorPin = config["openSensorPin"];
  this.sensorPollInMs = getVal(config, "pollInMs", 4000);
  this.monitoredDoorState = false;
  this.lastMonitoredDoorState = false;
  this.doorOpensInSeconds = config["opensInSeconds"];
  this.closedDoorSensorValue = getVal(config, "closedSensorValue", 1);
  this.openDoorSensorValue = getVal(config, "openSensorValue", 1);
  this.mockedOpenSensor = false;
  this.mockedClosedSensor = false;

  log("Switch Pin: " + this.doorSwitchPin);
  log("Switch Val: " + (this.relayOn == 1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));
  log("Switch Active Time in ms: " + this.doorSwitchPressTimeInMs);

  if (this.hasClosedSensor()) {
      log("Closed Sensor: Configured");
      log("    Closed Sensor Pin: " + this.closedDoorSensorPin);
      log("    Closed Sensor Val: " + (this.closedDoorSensorValue == 1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));
  } else {
      log("Closed Sensor: Not Configured");
  }

  if(this.hasOpenSensor()) {
      log("Open Sensor: Configured");
      log("    Open Sensor Pin: " + this.openDoorSensorPin);
      log("    Open Sensor Val: " + (this.openDoorSensorValue == 1 ? "ACTIVE_HIGH" : "ACTIVE_LOW"));
  } else {
      log("Open Sensor: Not Configured");
  }

  if (!this.hasClosedSensor() && !this.hasOpenSensor()) {
      this.wasClosed = true; //Set a valid initial state
      log("NOTE: Neither Open nor Closed sensor is configured. Will be unable to determine what state the " + this.name + " is in, and will rely on last known state.");
  }
  log("Sensor Poll in ms: " + this.sensorPollInMs);
  log("Opens in seconds: " + this.doorOpensInSeconds);
  this.initService();
}

GarageGateOpenerAccessory.prototype = {
  determineCurrentDoorStateWithOpenAndClosedSensors: function() {
    let isClosed = this.isClosed();
    let isOpen = this.isOpen();
    
    this.log("Running new door state code for double sensor config!")

    if (isOpen && !isClosed) {
      return DoorState.OPEN;
    }
    else if (isClosed && !isOpen) {
      return DoorState.CLOSED;
    }
    else if (!isClosed && !isOpen) {
      if (this.wasClosed){
        return DoorState.OPENING;
      } 
      else {
        return DoorState.CLOSING;
      }
    } 
    return DoorState.STOPPED
  },

  determineCurrentDoorState: function() {
    if (this.monitorDoorState) {return this.monitoredDoorState;}

    if ((this.hasOpenSensor()) && (!this.hasClosedSensor())) 
    {
      this.mockedClosedSensor = !this.isOpen();
      return this.isOpen() ? DoorState.OPEN : DoorState.CLOSED; 
    } else if ((!this.hasOpenSensor()) && (this.hasClosedSensor())) 
    {
      this.mockedOpenSensor = !this.isClosed();
      return this.isClosed() ? DoorState.CLOSED  : DoorState.OPEN;
    } else {
    // A UNKNOWN status is missing in homebridge.hap.Characteristic.CurrentDoorState
        return DoorState.OPEN; // I leave it open so it will encourage a field check
    }
  },
  
  doorStateToString: function(state) {
    switch (state) {
      case DoorState.OPEN:
        return "OPEN";
      case DoorState.CLOSED:
        return "CLOSED";
      case DoorState.STOPPED:
        return "STOPPED";
	  case DoorState.OPENING :
        return "OPENING ";
	  case DoorState.CLOSING :
        return "CLOSING ";
      default:
        return "UNKNOWN";
    }
  },

  monitorDoorState: function() {
     var isClosed = this.isClosed();
     var isOpen = this.isOpen();
     var state;

    //  this.log("monitoringDoorState - isOpen: " + isOpen + " isClosed: " + isClosed + " operating: " + this.operating + " wasClosed: " + this.wasClosed);
     
     if (!isClosed && !isOpen && (this.currentDoorState != DoorState.STOPPED)) {
      this.operating = true;
      state = this.wasClosed ? DoorState.OPENING : DoorState.CLOSING;
      this.targetState = (state == DoorState.OPENING) ? DoorState.OPEN : DoorState.CLOSED;
      // this.log("Door state changed to: " + this.doorStateToString(this.wasClosed ? DoorState.OPENING : DoorState.CLOSING));
     } else if (isClosed || isOpen) {
      this.operating = false;
      this.wasClosed = isClosed;
      this.targetState = isClosed ? DoorState.CLOSED : DoorState.OPEN;
      state = this.targetState;
     }

     // Tidy up mocked sensor status
     if (!this.hasClosedSensor() && isOpen) { this.mockedClosedSensor = false; }
     if (!this.hasOpenSensor() && isClosed) { this.mockedOpenSensor = false; }
    
     if ((this.monitoredDoorState != state) && (this.lastMonitoredDoorState != this.monitoredDoorState)) {
      this.lastMonitoredDoorState = this.monitoredDoorState;
      this.log("Door state changed to: " + this.doorStateToString(state));
     }

     this.monitoredDoorState = state;
     this.currentDoorState.setValue(state);
     if (this.debug) {
      this.log("Current door state: " + this.doorStateToString(state));
     }

     if (state == DoorState.OPENING && this.previousDoorState != state) {
      this.log("setting open timer");
      this.setOpenSensorTimer();
     } 
     else if (state == DoorState.CLOSING && this.previousDoorState != state) {
      this.log("setting closed timer");
      this.setClosedSensorTimer();
     }
     this.previousDoorState = state;
  },

  setMockOpenSensor: function(state) {
    this.mockedOpenSensor = state;
  },

  setMockClosedSensor: function(state) {
    this.mockedClosedSensor = state;
  },

  setOpenSensorTimer: function() {
    this.log("Setting timer for Open Sensor.");
    if (!this.hasOpenSensor()) {
      setTimeout(this.setMockOpenSensor.bind(this, true), this.doorOpensInSeconds * 1000);
    }  
  },

  setClosedSensorTimer: function() { 
    if (!this.hasClosedSensor()) {
      this.log("Setting timer for closed sensor.");
      setTimeout(this.setMockClosedSensor.bind(this, true), this.doorOpensInSeconds * 1000);
    } 
    else {
      setTimeout(this.setFinalDoorState.bind(this), this.doorOpensInSeconds * 1000 );
    } 
  },

  hasOpenSensor : function() {
    return this.openDoorSensorPin != null;
  },

  hasClosedSensor : function() {
    return this.closedDoorSensorPin != null;
  },

  initService: function() {
    this.garageDoorOpener = new Service.GarageDoorOpener(this.name,this.name);
    this.currentDoorState = this.garageDoorOpener.getCharacteristic(DoorState);
    this.currentDoorState.on('get', this.getState.bind(this));
    this.targetDoorState = this.garageDoorOpener.getCharacteristic(Characteristic.TargetDoorState);
    this.targetDoorState.on('set', this.setState.bind(this));
    this.targetDoorState.on('get', this.getTargetState.bind(this));
    var isClosed = this.isClosed();

    this.wasClosed = isClosed;
    this.operating = false;
    this.previousDoorState = this.currentDoorState
    this.infoService = new Service.AccessoryInformation();
    this.infoService
      .setCharacteristic(Characteristic.Manufacturer, "Opensource Community")
      .setCharacteristic(Characteristic.Model, "RaspPi GPIO GarageDoor")
      .setCharacteristic(Characteristic.SerialNumber, "Version 1.0.0");
  
    if (this.hasOpenSensor() || this.hasClosedSensor()) {
        this.log("We have a sensor, monitoring state enabled.");
        this.monitoringDoorState = true;
        setInterval(this.monitorDoorState.bind(this), this.sensorPollInMs);
    }

    this.log("Initial State: " + (isClosed ? "CLOSED" : "OPEN"));
    this.currentDoorState.setValue(isClosed ? DoorState.CLOSED : DoorState.OPEN);
    this.targetDoorState.setValue(isClosed ? DoorState.CLOSED : DoorState.OPEN);

  },

  getTargetState: function(callback) {
    this.log("getTargetState() - returning: " + this.doorStateToString(this.targetState) + " (" + this.targetState + ")");
    callback(null, this.targetState);
  },

  readPin: function(pin) {
    return parseInt(fs.readFileSync("/sys/class/gpio/gpio"+pin+"/value", "utf8").trim());
  },

  writePin: function(pin,val) {
    fs.writeFileSync("/sys/class/gpio/gpio"+pin+"/value", val.toString());
  },

  isClosed: function() {
    let sensorValue;

    if (this.hasClosedSensor()) {
      sensorValue = this.readPin(this.closedDoorSensorPin) == this.closedDoorSensorValue;
    } else {
      sensorValue = this.mockedClosedSensor;
    }
    return sensorValue;
  },

  isOpen: function() {
    let sensorValue;

    if (this.hasOpenSensor()) {
      sensorValue = this.readPin(this.openDoorSensorPin) == this.openDoorSensorValue;
    } else {
      sensorValue = this.mockedOpenSensor;
    }
    return sensorValue;
  },

  _isClosed: function() {
    if (this.hasClosedSensor()) {
        return this.readPin(this.closedDoorSensorPin) == this.closedDoorSensorValue;
    } else if (this.hasOpenSensor()) {
        return !this.isOpen();
    } else {
        return this.wasClosed;
    }
  },

  _isOpen: function() {
    if (this.hasOpenSensor()) {
        return this.readPin(this.openDoorSensorPin) == this.openDoorSensorValue;
    } else if (this.hasClosedSensor()) {
        return !this.isClosed();
    } else {
        return !this.wasClosed;
    }
  },

  switchOn: function() {
    this.writePin(this.doorSwitchPin, this.relayOn);
    this.log("Turning on " + this.name + " Relay, pin " + this.doorSwitchPin + " = " + this.relayOn);
    setTimeout(this.switchOff.bind(this), this.doorSwitchPressTimeInMs);
  },

  switchOff: function() {
    this.writePin(this.doorSwitchPin, this.relayOff);
    this.log("Turning off " + this.name + " Relay, pin " + this.doorSwitchPin + " = " + this.relayOff);
  },

  setFinalDoorState: function() {
    let isOpen = this.isOpen();
    let isClosed = this.isClosed();

    this.log("setFinalDoorState - target: " + this.doorStateToString(this.targetState) + " isOpen: " + isOpen + " isClosed: " + isClosed);

    if ((this.targetState == DoorState.CLOSED && !isClosed) || (this.targetState == DoorState.OPEN && !isOpen) ) {
      this.log("Was trying to " + (this.targetState == DoorState.CLOSED ? "CLOSE" : "OPEN") + " " + this.name + " , but it is still " + (isClosed ? "CLOSED":"OPEN"));
      this.currentDoorState.setValue(DoorState.STOPPED);
    } 
    else {
      this.log("Set current state to " + this.doorStateToString(this.targetState));
      this.wasClosed = this.targetState == DoorState.CLOSED;
      this.currentDoorState.setValue(this.targetState);
      
      if (this.hasClosedSensor && !this.hasOpenSensor) {
        this.mockedOpenSensor = !this.wasClosed;
      } else if (!this.hasClosedSensor && this.hasOpenSensor) {
        this.mockedClosedSensor = this.wasClosed;
      }
    }
    this.operating = false;
  },

  setState: function(state, callback) {
    this.log("setState() - Setting target state to (" + state + ") " + this.doorStateToString(state) );
    this.targetState = state;
    let isClosed = this.isClosed();
    if ((state == DoorState.OPEN && isClosed) || (state == DoorState.CLOSED && !isClosed)) {
        this.log("Triggering " + this.name + " Relay");
        this.operating = true;
        if (state == DoorState.OPEN) {
            this.currentDoorState.setValue(DoorState.OPENING);
        } else {
            this.currentDoorState.setValue(DoorState.CLOSING);
        }
	setTimeout(this.setFinalDoorState.bind(this), this.doorOpensInSeconds * 1000);
	this.switchOn();
    }

    callback();
    return true;
  },

  getState: function(callback) {
    // let isClosed = this.isClosed();
    // let isOpen = this.isOpen();
    // let state = isClosed ? DoorState.CLOSED : isOpen ? DoorState.OPEN : DoorState.STOPPED;
    // if (isOpen && this.wasClosed) {
    //   this.targetState = DoorState.OPEN;
    // } else if (isClosed && !this.wasClosed) {
    //   this.targetState = DoorState.CLOSED;
    // }
    // this.log("getState() - " + this.name + " is " + (isClosed ? "CLOSED ("+DoorState.CLOSED+")" : isOpen ? "OPEN ("+DoorState.OPEN+")" : "STOPPED (" + DoorState.STOPPED + ")")); 
    this.log("getState() - " + this.name + " is " + this.doorStateToString(this.monitoredDoorState));
    // callback(null, state);  
    callback(null, this.monitoredDoorState)
  },


  getServices: function() {
    return [this.infoService, this.garageDoorOpener];
  }
};