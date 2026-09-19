/** Generated from original AWP MDL and original ELF event registration. */
export const SOURCE_AWP_ANIMATION_DATA=[
  {
    "sequence": 0,
    "name": "awp_idle",
    "duration": 0.03333333507180214,
    "fadeOut": 0.20000000298023224,
    "flags": 0,
    "events": []
  },
  {
    "sequence": 1,
    "name": "awp_fire",
    "duration": 1.6666666269302368,
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
        "recordEvent": 0,
        "type": 1024,
        "cycle": 0.20000000298023224,
        "options": "",
        "name": "AE_WPN_UNZOOM"
      },
      {
        "record": 2,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.36000001430511475,
        "options": "Weapon_AWP.BoltBack",
        "name": ""
      },
      {
        "record": 3,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.5600000023841858,
        "options": "Weapon_AWP.BoltForward",
        "name": ""
      },
      {
        "record": 4,
        "recordEvent": 71,
        "type": 1040,
        "cycle": 0.46000000834465027,
        "options": "",
        "name": "AE_CLIENT_EJECT_BRASS"
      }
    ]
  },
  {
    "sequence": 2,
    "name": "awp_draw",
    "duration": 1.25,
    "fadeOut": 0.20000000298023224,
    "flags": 2,
    "events": [
      {
        "record": 0,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.0,
        "options": "Weapon_AWP.Draw",
        "name": ""
      },
      {
        "record": 1,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.23333333432674408,
        "options": "Weapon_AWP.BoltBack",
        "name": ""
      },
      {
        "record": 2,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.46666666865348816,
        "options": "Weapon_AWP.BoltForward",
        "name": ""
      }
    ]
  },
  {
    "sequence": 3,
    "name": "awp_reload",
    "duration": 3.6666667461395264,
    "fadeOut": 0.20000000298023224,
    "flags": 2,
    "events": [
      {
        "record": 0,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.06363636255264282,
        "options": "Weapon_AWP.Clipout",
        "name": ""
      },
      {
        "record": 1,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.3636363744735718,
        "options": "Weapon_AWP.Clipin",
        "name": ""
      },
      {
        "record": 2,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.5454545617103577,
        "options": "Weapon_AWP.Cliphit",
        "name": ""
      },
      {
        "record": 3,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.699999988079071,
        "options": "Weapon_AWP.BoltBack",
        "name": ""
      },
      {
        "record": 4,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.8090909123420715,
        "options": "Weapon_AWP.BoltForward",
        "name": ""
      },
      {
        "record": 5,
        "recordEvent": 54,
        "type": 1041,
        "cycle": 0.5454545617103577,
        "options": "",
        "name": "AE_WPN_COMPLETE_RELOAD"
      }
    ]
  },
  {
    "sequence": 4,
    "name": "lookat01",
    "duration": 5.0,
    "fadeOut": 0.30000001192092896,
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
        "cycle": 0.5866666436195374,
        "options": "0",
        "name": "AE_CL_SET_STATTRAK_GLOW"
      },
      {
        "record": 2,
        "recordEvent": 72,
        "type": 1041,
        "cycle": 0.5799999833106995,
        "options": "0.2066",
        "name": "AE_BEGIN_TAUNT_LOOP"
      },
      {
        "record": 3,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.03333333507180214,
        "options": "Weapon_AWP.WeaponMove1",
        "name": ""
      },
      {
        "record": 4,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.6066666841506958,
        "options": "Weapon_AWP.WeaponMove2",
        "name": ""
      },
      {
        "record": 5,
        "recordEvent": 5004,
        "type": 0,
        "cycle": 0.7733333110809326,
        "options": "Weapon_AWP.WeaponMove3",
        "name": ""
      }
    ]
  },
  {
    "sequence": 5,
    "name": "lookat01_prepare",
    "duration": 1.0333333015441895,
    "fadeOut": 0.20000000298023224,
    "flags": 0,
    "events": []
  },
  {
    "sequence": 6,
    "name": "lookat01_loop",
    "duration": 3.7333333492279053,
    "fadeOut": 0.20000000298023224,
    "flags": 0,
    "events": []
  }
] as const;
