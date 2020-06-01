const { app, BrowserWindow } = require('electron');
const path = require('path');
const Mfrc522 = require("mfrc522-rpi");
const SoftSPI = require("rpi-softspi");
const Store = require('./store.js');
const ipcMain = require('electron').ipcMain;
var Gpio = require('onoff').Gpio;

var pinEnable = new Gpio(13, 'out');
var pinDir = new Gpio(19, 'out');
var pinPulse = new Gpio(26, 'out');

const piGpio = require('pigpio').Gpio;

// The number of microseconds it takes sound to travel 1cm at 20 degrees celcius
const MICROSECDONDS_PER_CM = 1e6/34321;

const trigger = new piGpio(23, {mode: Gpio.OUTPUT});
const echo = new piGpio(24, {mode: Gpio.INPUT, alert: true});

trigger.digitalWrite(0); // Make sure trigger is low

const watchHCSR04 = () => {
  let startTick;

  echo.on('alert', (level, tick) => {
    if (level == 1) {
      startTick = tick;
    } else {
      const endTick = tick;
      const diff = (endTick >> 0) - (startTick >> 0); // Unsigned 32 bit arithmetic
      console.log(diff / 2 / MICROSECDONDS_PER_CM);
    }
  });
};

watchHCSR04();

// Trigger a distance measurement once per second
setInterval(() => {
  trigger.trigger(10, 1); // Set trigger high for 10 microseconds
}, 1000);

//# This loop keeps checking for chips. If one is near it will get the UID and authenticate
console.log("scanning...");
console.log("Please put chip or keycard in the antenna inductive zone!");
console.log("Press Ctrl-C to stop.");

// var stepperEnable = new Gpio(13, 'out');
// var stepperDir = new Gpio(19, 'out');
// var stepperPulse = new Gpio(26, 'out');

const store = new Store({
  // We'll call our data file 'user-preferences'
  configName: 'user-preferences',
  defaults: {
    // 800x600 is the default size of our window
    windowBounds: { beras: 2 }
  }
});

const softSPI = new SoftSPI({
  clock: 23, // pin number of SCLK
  mosi: 19, // pin number of MOSI
  miso: 21, // pin number of MISO
  client: 24 // pin number of CS
});

// GPIO 24 can be used for buzzer bin (PIN 18), Reset pin is (PIN 22).
// I believe that channing pattern is better for configuring pins which are optional methods to use.
const mfrc522 = new Mfrc522(softSPI).setResetPin(22).setBuzzerPin(18);

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) { // eslint-disable-line global-require
  app.quit();
}
// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  // createWindow()
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {nodeIntegration: true}
  });

  let { beras } = store.get('windowBounds');
  console.log(beras)

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  // mainWindow.webContents.openDevTools();
  
  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow() 
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    // stepperDir.writeSync(1);
    // stepperPulse.writeSync(1);
    // stepperEnable.writeSync(1);

    mainWindow.webContents.send('admin-data', beras);
    setInterval(function() {
      //# reset card
      mfrc522.reset();

      //# Scan for cards
      let response = mfrc522.findCard();
      if (!response.status) {
        // mainWindow.webContents.send('store-data', 'No Card');
        console.log("No Card");
        return;
      }
      // mainWindow.webContents.send('store-data', 'Card detected, CardType: ' + response.bitSize);
      console.log("Card detected, CardType: " + response.bitSize);

      //# Get the UID of the card
      response = mfrc522.getUid();
      if (!response.status) {
        console.log("UID Scan Error");
        // mainWindow.webContents.send('store-data', 'UID Scan Error');
        return;
      }
      //# If we have the UID, continue
      const uid = response.data;
      // mainWindow.webContents.send('store-data', uid[0].toString(16));
      // mainWindow.webContents.send('store-data', uid[1].toString(16));
      // mainWindow.webContents.send('store-data', uid[2].toString(16));
      // mainWindow.webContents.send('store-data', uid[3].toString(16));
      console.log(
        "Card read UID: %s %s %s %s",
        uid[0].toString(16),
        uid[1].toString(16),
        uid[2].toString(16),
        uid[3].toString(16)
      );

      //# Select the scanned card
      const memoryCapacity = mfrc522.selectCard(uid);
      // mainWindow.webContents.send('store-data', "Card Memory Capacity: " + memoryCapacity);
      console.log("Card Memory Capacity: " + memoryCapacity);

      //# This is the default key for authentication
      const key = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

      var blockIndexes = [1, 4];
      var isAdmin = false;

      for (var i=0; i<blockIndexes.length; i++) {
        if (!mfrc522.authenticate(blockIndexes[i], key, uid)) {
          console.log("Authentication Error");
          // mainWindow.webContents.send('store-data', "Authentication Error");
          return;
        }

        let bufferOriginal = Buffer.from(mfrc522.getDataForBlock(blockIndexes[i]));

        console.log("Block: " + blockIndexes[i] + " Data: " + bufferOriginal.toString('utf8'));

        if (blockIndexes[i] == 1) {
          if (bufferOriginal.toString('utf8').includes("admn")) {
            console.log('this is admin')
            isAdmin = true
            mainWindow.webContents.send('role-data', "admin");
          } else {
            console.log('this is not admin')
            isAdmin = false
          }
        }


        if (blockIndexes[i] == 4) {
          if (!isAdmin) {
            mainWindow.webContents.send('store-data', bufferOriginal.toString('utf8'));
            var intKuota = parseInt(bufferOriginal.toString('utf8'), 10);
            var jatahSubs = parseInt(beras);

            if (intKuota > jatahSubs) {
              console.log('cukup')
              var newKuota = intKuota - jatahSubs;
              var buf = Buffer.from(newKuota.toString(), 'utf8');
              
              console.log("STEPPER ROTATING");
              pinEnable.writeSync(0)
              pinDir.writeSync(1)
              for (var i=0; i<(jatahSubs*1600); i++) {
                pinPulse.writeSync(1);
                wait(10);
                pinPulse.writeSync(0)
                wait(10);
              }

            } else {
              console.log('kurang')
            }
            var newData = [];

            for (var i=0; i<buf.length; i++) {
              newData.push(buf[i])
            }

            // let data = [
            //   52,
            //   53
            // ];
            // console.log(data)
            console.log(newData)
            mfrc522.writeDataToBlock(4, newData)
          }
        }

      }

      //# Stop
      mfrc522.stopCrypto();
    }, 500);
  })
})

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('kuota', function(event, data) {
      store.set('windowBounds', { beras: data });
});

function wait(ms){
   var start = new Date().getTime();
   var end = start;
   while(end < start + ms) {
     end = new Date().getTime();
  }
}