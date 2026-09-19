/** Generated from original Deagle MDL and original ELF event registration. */
export const SOURCE_DEAGLE_ANIMATION_DATA=[
  {
    "sequence": 0,
    "name": "idle1",
    "duration": 0.03333333507180214,
    "fadeOut": 0.20000000298023224,
    "flags": 0,
    "events": []
  },
  {
    "sequence": 1,
    "name": "shoot1",
    "duration": 0.675000011920929,
    "fadeOut": 0.20000000298023224,
    "flags": 2,
    "events": [
      {
        "record": 0,
        "recordEvent": 5001,
        "type": 0,
        "cycle": 0.0,
        "options": "1",
        "name": ""
      },
      {
        "record": 1,
        "recordEvent": 71,
        "type": 1040,
        "cycle": 0.0,
        "options": "",
        "name": "AE_CLIENT_EJECT_BRASS"
      }
    ]
  },
  {
    "sequence": 2,
    "name": "shoot2",
    "duration": 0.675000011920929,
    "fadeOut": 0.20000000298023224,
    "flags": 2,
    "events": [
      {
        "record": 0,
        "recordEvent": 5001,
        "type": 0,
        "cycle": 0.0,
        "options": "1",
        "name": ""
      },
      {
        "record": 1,
        "recordEvent": 71,
        "type": 1040,
        "cycle": 0.0,
        "options": "",
        "name": "AE_CLIENT_EJECT_BRASS"
      }
    ]
  },
  {
    "sequence": 3,
    "name": "shoot3",
    "duration": 0.675000011920929,
    "fadeOut": 0.20000000298023224,
    "flags": 2,
    "events": [
      {
        "record": 0,
        "recordEvent": 5001,
        "type": 0,
        "cycle": 0.0,
        "options": "1",
        "name": ""
      },
      {
        "record": 1,
        "recordEvent": 71,
        "type": 1040,
        "cycle": 0.0,
        "options": "",
        "name": "AE_CLIENT_EJECT_BRASS"
      }
    ]
  },
  {
    "sequence": 4,
    "name": "shoot_empty",
    "duration": 0.675000011920929,
    "fadeOut": 0.20000000298023224,
    "flags": 2,
    "events": [
      {
        "record": 0,
        "recordEvent": 5001,
        "type": 0,
        "cycle": 0.0,
        "options": "11",
        "name": ""
      },
      {
        "record": 1,
        "recordEvent": 71,
        "type": 1040,
        "cycle": 0.0,
        "options": "",
        "name": "AE_CLIENT_EJECT_BRASS"
      }
    ]
  },
  {
    "sequence": 5,
    "name": "reload",
    "duration": 2.200000047683716,
    "fadeOut": 0.20000000298023224,
    "flags": 0,
    "events": [
      {
        "record": 0,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.12121212482452393,
        "options": "Weapon_DEagle.Clipout",
        "name": ""
      },
      {
        "record": 1,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.28787878155708313,
        "options": "Weapon_DEagle.Clipin",
        "name": ""
      },
      {
        "record": 2,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.6212121248245239,
        "options": "Weapon_DEagle.Slideback",
        "name": ""
      },
      {
        "record": 3,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.7121211886405945,
        "options": "Weapon_DEagle.Slideforward",
        "name": ""
      },
      {
        "record": 4,
        "recordEvent": 54,
        "type": 1041,
        "cycle": 0.39393940567970276,
        "options": "",
        "name": "AE_WPN_COMPLETE_RELOAD"
      }
    ]
  },
  {
    "sequence": 6,
    "name": "draw",
    "duration": 1.0,
    "fadeOut": 0.20000000298023224,
    "flags": 2,
    "events": [
      {
        "record": 0,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.0,
        "options": "Weapon_DEagle.Draw",
        "name": ""
      }
    ]
  },
  {
    "sequence": 7,
    "name": "lookat01",
    "duration": 5.666666507720947,
    "fadeOut": 0.20000000298023224,
    "flags": 0,
    "events": [
      {
        "record": 0,
        "recordEvent": 73,
        "type": 1040,
        "cycle": 0.0,
        "options": "1",
        "name": "AE_CL_SET_STATTRAK_GLOW"
      },
      {
        "record": 1,
        "recordEvent": 73,
        "type": 1040,
        "cycle": 0.7588235139846802,
        "options": "0",
        "name": "AE_CL_SET_STATTRAK_GLOW"
      },
      {
        "record": 2,
        "recordEvent": 72,
        "type": 1041,
        "cycle": 0.7529411911964417,
        "options": "0.511764",
        "name": "AE_BEGIN_TAUNT_LOOP"
      },
      {
        "record": 3,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.0117647061124444,
        "options": "Weapon_DEagle.WeaponMove1",
        "name": ""
      },
      {
        "record": 4,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.2235294133424759,
        "options": "Weapon_DEagle.WeaponMove3",
        "name": ""
      },
      {
        "record": 5,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.25294119119644165,
        "options": "Weapon_DEagle.WeaponMove4",
        "name": ""
      },
      {
        "record": 6,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.770588219165802,
        "options": "Weapon_DEagle.WeaponMove2",
        "name": ""
      },
      {
        "record": 7,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.8058823347091675,
        "options": "Weapon_DEagle.WeaponMove4",
        "name": ""
      }
    ]
  },
  {
    "sequence": 8,
    "name": "lookat02",
    "duration": 8.5,
    "fadeOut": 0.20000000298023224,
    "flags": 0,
    "events": [
      {
        "record": 0,
        "recordEvent": 73,
        "type": 1040,
        "cycle": 0.0,
        "options": "1",
        "name": "AE_CL_SET_STATTRAK_GLOW"
      },
      {
        "record": 1,
        "recordEvent": 73,
        "type": 1040,
        "cycle": 0.5058823823928833,
        "options": "0",
        "name": "AE_CL_SET_STATTRAK_GLOW"
      },
      {
        "record": 2,
        "recordEvent": 72,
        "type": 1041,
        "cycle": 0.8235294222831726,
        "options": "0.254901",
        "name": "AE_BEGIN_TAUNT_LOOP"
      },
      {
        "record": 3,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.03529411926865578,
        "options": "Weapon_DEagle.LookAt009",
        "name": ""
      },
      {
        "record": 4,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.1411764770746231,
        "options": "Weapon_DEagle.LookAt036",
        "name": ""
      },
      {
        "record": 5,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.2235294133424759,
        "options": "Weapon_DEagle.LookAt057",
        "name": ""
      },
      {
        "record": 6,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.3176470696926117,
        "options": "Weapon_DEagle.LookAt081",
        "name": ""
      },
      {
        "record": 7,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.43529412150382996,
        "options": "Weapon_DEagle.LookAt111",
        "name": ""
      },
      {
        "record": 8,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.5215686559677124,
        "options": "Weapon_DEagle.LookAt133",
        "name": ""
      },
      {
        "record": 9,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.6509804129600525,
        "options": "Weapon_DEagle.LookAt166",
        "name": ""
      },
      {
        "record": 10,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.7568627595901489,
        "options": "Weapon_DEagle.LookAt193",
        "name": ""
      },
      {
        "record": 11,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.8941176533699036,
        "options": "Weapon_DEagle.LookAt228",
        "name": ""
      }
    ]
  }
] as const;
