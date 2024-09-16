const OSC = require('osc-js');

const rtpmidi = require('../index');

class Fader {
  constructor(index, current = 0, isTouching = false) {
    this._current = current;
    this.new = 0;
    this.touching = isTouching;
    const statusByte = 0xE0 + (index - 1);
    this.valueBuffer = [statusByte, 0x00, 0x00];
  }

  get current() {
    return this._current;
  }

  set current(value) {
    this._current = value;
    const fullRangeValue = Math.floor(this.current * 16383);
    this.valueBuffer[1] = fullRangeValue % 128;
    this.valueBuffer[2] = fullRangeValue >> 7;
  }

  toJSON(index) {
    return {
      index,
      current: this._current,
      isTouching: this.touching,
    };
  }

  static fromJSON({ index, current, isTouching }) {
    return new Fader(index, current, isTouching);
  }
}

class ButtonSet {
  constructor(index) {
    // four buttons for each set
    this._status = [
      false,
      false,
      false,
      false
    ];
    // 0x90 is note-on midi value
    this._noteOffset = index - 1;
    this.valueBuffer = [
      [0x90, this._noteOffset + 0, 0x00],
      [0x90, this._noteOffset + 8, 0x00],
      [0x90, this._noteOffset + 16, 0x00],
      [0x90, this._noteOffset + 24, 0x00]
    ]
  }

  get status() {
    return this._status;
  }

  setStatus(index, status) {
    this._status[index] = status;
    const indexOffset = index * 8;
    this.valueBuffer[index] = 
      [ 0x90, this._noteOffset + indexOffset, status ? 127 : 0];
  }

}

let banks = [];

let configFile = Bun.file('./config.json');
if (await configFile.exists()) {
  const contents = await configFile.json();
  banks = contents.map(bank =>
    Object.keys(bank).reduce((loadedBank, faderKey) => {
      loadedBank[faderKey] = Fader.fromJSON(bank[faderKey]);
      return loadedBank;
    }, {})
  );
} else {
  // Create 6 banks of 9 faders
  for (let i = 0; i < 6; i++) {
    const bank = {
      fader1: new Fader(1),
      buttons1: new ButtonSet(1),
      fader2: new Fader(2),
      buttons2: new ButtonSet(2),
      fader3: new Fader(3),
      buttons3: new ButtonSet(3),
      fader4: new Fader(4),
      buttons4: new ButtonSet(4),
      fader5: new Fader(5),
      buttons5: new ButtonSet(5),
      fader6: new Fader(6),
      buttons6: new ButtonSet(6),
      fader7: new Fader(7),
      buttons7: new ButtonSet(7),
      fader8: new Fader(8),
      buttons8: new ButtonSet(8),
      fader9: new Fader(9),
      buttons9: new ButtonSet(9)
    };
    banks.push(bank);
  }
}

let currentBank = 0; // Default to the first bank

const session = rtpmidi.manager.createSession({
  localName: 'Session 1',
  bonjourName: 'Node RTPMidi',
  port: 5006,
});

// Start an osc server
const osc = new OSC({
  plugin: new OSC.DatagramPlugin({
    type: 'udp4',
    open: { host: '0.0.0.0', port: 8011 },
    send: { host: '192.168.85.116', port: 8010 }
  })
});

osc.on('open', () => {
  console.log(`OSC server opened`);
})
osc.open();

// save session every 5 seconds
setInterval(() => {
  // Convert banks and fader instances to plain objects
  const bankData = banks.map(bank =>
    Object.keys(bank).reduce((plainBank, faderKey) => {
      const fader = bank[faderKey];
      plainBank[faderKey] = fader.toJSON(faderKey.match(/\d+/)[0]);
      return plainBank;
    }, {})
  );
  Bun.write("./config.json", JSON.stringify(bankData, null, 2));
}, 5000);

// Enable some console output
// rtpmidi.log.level = 4;

// -- Helper function to update the motor fader values on the device
function updateFaderValues() {
  const activeBank = banks[currentBank];
  Object.keys(activeBank).forEach(faderKey => {
    if (!faderKey.includes('fader')) return;
    const fader = activeBank[faderKey];
    session.sendMessage(10, fader.valueBuffer);  // Send the current fader value
    const oscAddress = `/bank${currentBank + 1}/${faderKey}`;
    osc.send(new OSC.Message(oscAddress, fader.current));
  });
}

// -- Helper function to update the bank LED indicators
function updateBankLeds() {
  const bankButtons = [91, 92, 94, 93, 95, 86];  // Define the note numbers for each bank button
  bankButtons.forEach((button, index) => {
    if (index === currentBank) {
      // Send the onCommand for the active bank
      session.sendMessage(500, [0x90, button, 0x7F]);
    } else {
      // Send the offCommand for all other banks
      session.sendMessage(500, [0x90, button, 0x00]);
    }
  });
}

// -- Helper function to update the button LED indicators
function updateButtonSetLeds() {
  const activeBank = banks[currentBank];
  Object.keys(activeBank).forEach(buttonKey => {
    if (!buttonKey.includes('buttons')) return;
    const buttonSet = activeBank[buttonKey];
  });
}

session.on('ready', () => {
  updateFaderValues();
  updateBankLeds();

  // Blink on/off
  const onCommand = [0x90, 0x18, 0x7F];
  const offCommand = [0x90, 0x18, 0x00];
  let active = false;
  setInterval(() => {
    if (!active) {
      session.sendMessage(500, onCommand);
      active = true;
    } else {
      session.sendMessage(500, offCommand);
      active = false;
    }
  }, 500);

});

// Route the messages
session.on('message', (deltaTime, message) => {
  const [status, byte1, byte2] = Array.from(message);
  // aliases for the incoming bytes
  const ccNumber = byte1;
  const noteNumber = byte1;
  const value = byte2;
  const velocity = byte2;

  // -- Fader pitch-bend messages
  if (status >= 0xE0 && status <= 0xE8) {
    const faderNumber = status - 0xE0 + 1;
    const fader = banks[currentBank][`fader${faderNumber}`];
    if (fader.touching) {
      const normalisedValue = (byte2 * 128 + byte1) / 16383;
      fader.new = normalisedValue;

      console.log(`Received Pitch Bend message for Fader ${faderNumber} in Bank ${currentBank + 1}: ${normalisedValue.toFixed(3)}`);

      const oscAddress = `/bank${currentBank + 1}/fader${faderNumber}`;
      osc.send(new OSC.Message(oscAddress, normalisedValue));
    }
  }

  // -- Fader touch messages
  else if (status === 0x90 && ccNumber >= 0x68 && ccNumber <= 0x70) {
    const faderNumber = ccNumber - 0x67; // Map 0x68 to 1, 0x69 to 2, ..., 0x70 to 9
    const fader = banks[currentBank][`fader${faderNumber}`];

    if (fader) {
      if (value === 0x7f) {
        fader.touching = true;
      } else if (value === 0x00) {
        fader.touching = false;
        fader.current = fader.new;
        session.sendMessage(10, fader.valueBuffer);
      }
      console.log(`Fader ${faderNumber} in Bank ${currentBank + 1} is now ${fader.touching ? 'touching' : 'not touching'}`);
      if (!fader.touching) {
        console.log(`Fader ${faderNumber} in Bank ${currentBank + 1} current value is now ${fader.current.toFixed(3)}`);
      }
    }
  }

  // -- Handle bank switching

  // Switch banks on these specific button presses
  else if (status === 0x90) {

    if (value === 127) {
      switch (ccNumber) {
        case 91: currentBank = 0; break;
        case 92: currentBank = 1; break;
        case 94: currentBank = 2; break;
        case 93: currentBank = 3; break;
        case 95: currentBank = 4; break;
        case 86: currentBank = 5; break;
        default: console.log(`Unhandled note on: ccNumber=${ccNumber}, value=${value}`);
      }
      updateFaderValues();
      updateBankLeds();
    }
  }

  // Unhandled incoming cc
  else {
    console.log(`Received CC message: status=${status}, ccNumber=${ccNumber}, value=${value}`);
  }
});

// Connect to a remote session
session.connect({ address: '192.168.85.183', port: 5004 });

