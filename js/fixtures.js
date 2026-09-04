
"use strict";

/*
 * ============================================================
 * FIXTURE LIBRARY
 * ============================================================
 *
 * PHOTOMETRICS POLICY
 * -------------------
 *
 * The photometric values in this file are intended to represent
 * MANUFACTURER-PUBLISHED specifications wherever an exact
 * fixture/model could be verified.
 *
 * IMPORTANT:
 *
 *  - Fixture electrical wattage is NOT luminous flux.
 *  - Lamp wattage is NOT fixture luminous flux.
 *  - A manufacturer's lamp lumen figure is NOT necessarily the
 *    same as the measured luminous flux of the complete fixture.
 *  - Zoom fixtures may have a range rather than one beam angle.
 *  - Some manufacturers publish illuminance but not lumens.
 *
 * Therefore:
 *
 *     ratedLumens
 *
 * is ONLY populated when an appropriate manufacturer figure
 * could be established.
 *
 * If the manufacturer does not publish a trustworthy lumen
 * figure for the exact fixture:
 *
 *     ratedLumens: null
 *
 * is used instead of inventing a number.
 *
 * `verified: true`
 *     Manufacturer specification verified.
 *
 * `verified: false`
 *     Exact manufacturer photometric figure could not be
 *     established reliably.
 *
 * `beamAngle`
 *     Fixed/representative beam angle where appropriate.
 *
 * `beamAngleMin`
 * `beamAngleMax`
 *     Used for zoom-capable fixtures.
 *
 * `outputScale`
 *     VISUALISATION correction only.
 *
 * It is NOT a manufacturer measurement.
 *
 * ============================================================
 */


const FixtureLibrary = {


    "Generic RGBW Moving Head (14ch - Home Fixture)": {
    type: "moving",
    channels: 14,

    map: {
        pan: 0,
        panf: 1,
        tilt: 2,
        tiltf: 3,

        intensity: 4,
        dimmer: 4,

        strobe: 5,

        r: 6,
        g: 7,
        b: 8,
        w: 9

        // Channels 11-14 currently unused / unknown
    },

    photometrics: {
        sourceType: "LED",

        /*
         * Exact manufacturer/model is unknown.
         * These are deliberately conservative VISUALISATION
         * values, NOT claimed manufacturer specifications.
         */
        ratedLumens: 3000,
        beamAngle: 20,
        outputScale: 0.60,

        verified: false,
        manufacturer: "Unknown",
        model: "Unknown",
        sourceNote:
            "User-identified generic RGBW moving head. " +
            "DMX channels 1-10 identified by user; channels 11-14 unknown."
    }
},

    /*
     * ========================================================
     * SHOWTEC
     * ========================================================
     */

    "Showtec Performer Profile 600 MKIII DDT": {
        type: "dimmer",
        channels: 3,
        map: {
            dimmer: 0,
            intensity: 0,
            dimmerFine: 1,
            strobe: 2
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 10665,

            /*
             * The Profile 600 MKIII uses interchangeable
             * fixed/zoom lenses. There is therefore no single
             * universal beam angle belonging to the light engine.
             */
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,

            outputScale: 1.00,

            colourTemperature: 3200,
            sourcePowerWatts: 260
        }
    },


    "Showtec Compact Par 18 Q4 (4ch RGBW)": {
        type: "rgbw",
        channels: 4,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 4997,
            beamAngle: 15,
            outputScale: 1.00,
            sourcePowerWatts: 126
        }
    },


    "Showtec Compact Par 18 Q4 (6ch)": {
        type: "rgbw",
        channels: 6,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4,
            strobe: 5
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 4997,
            beamAngle: 15,
            outputScale: 1.00,
            sourcePowerWatts: 126
        }
    },


    "Showtec Compact Par 18 Q4 (10ch)": {
        type: "rgbw",
        channels: 10,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4,
            strobe: 5,
            speed: 6,
            colmacro: 7,
            autoSpeed: 8,
            mode: 9
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 4997,
            beamAngle: 15,
            outputScale: 1.00,
            sourcePowerWatts: 126
        }
    },


    /*
     * IMPORTANT:
     *
     * Your original entries called these "Tungsten".
     * The actual Showtec Performer 1500 Fresnel Tungsten
     * is a 100 W WARM-WHITE LED fixture.
     *
     * It is NOT a 1500 W tungsten lamp.
     */

    "Showtec Performer 1500 Fresnel Tungsten (1ch)": {
        type: "dimmer",
        channels: 1,
        map: {
            dimmer: 0,
            intensity: 0
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 4781,
            beamAngle: null,
            beamAngleMin: 10,
            beamAngleMax: 50,
            outputScale: 1.00,
            colourTemperatureMin: 2700,
            colourTemperatureMax: 4500,
            sourcePowerWatts: 100
        }
    },


    "Showtec Performer 1500 Fresnel Tungsten (2ch)": {
        type: "dimmer",
        channels: 2,
        map: {
            dimmer: 0,
            intensity: 0,
            dimmerFine: 1
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 4781,
            beamAngle: null,
            beamAngleMin: 10,
            beamAngleMax: 50,
            outputScale: 1.00,
            colourTemperatureMin: 2700,
            colourTemperatureMax: 4500,
            sourcePowerWatts: 100
        }
    },


    "Showtec Performer 1500 Fresnel Tungsten (3ch VW.D)": {
        type: "tungsten",
        channels: 3,
        map: {
            dimmer: 0,
            intensity: 0,
            warmWhite: 1,
            coolWhite: 2
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 4781,
            beamAngle: null,
            beamAngleMin: 10,
            beamAngleMax: 50,
            outputScale: 1.00,
            colourTemperatureMin: 2700,
            colourTemperatureMax: 4500,
            sourcePowerWatts: 100
        }
    },


    "Showtec Performer 1500 Fresnel Tungsten (8ch STD.P)": {
        type: "tungsten",
        channels: 8,
       map: {
    dimmer: 0,
    intensity: 0,

    dimmerFine: 1,

    warmWhite: 2,
    warmWhiteFine: 3,

    naturalWhite: 4,
    naturalWhiteFine: 5,

    cct: 6,

    strobe: 7
},

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 4781,
            beamAngle: null,
            beamAngleMin: 10,
            beamAngleMax: 50,
            outputScale: 1.00,
            colourTemperatureMin: 2700,
            colourTemperatureMax: 4500,
            sourcePowerWatts: 100
        }
    },

    "Showtec Performer Profile 650 Q5 (8ch SIMPLE)": {
    type: "rgbal",
    channels: 8,

    map: {
        dimmer: 0,
        intensity: 0,

        r: 1,
        g: 2,
        b: 3,
        a: 4,
        l: 5,

        strobe: 6,
        performance: 7
    },

    photometrics: {
        verified: true,
        sourceType: "LED",

        /*
         * 240 W 5-in-1 RGBAL LED array.
         * Beam angle depends on the fitted lens.
         */
        ratedLumens: null,
        beamAngle: null,
        beamAngleMin: 15,
        beamAngleMax: 50,

        outputScale: 1.00,

        sourcePowerWatts: 240,

        manufacturer: "Showtec",
        model: "Performer Profile 650 Q5",

        sourceNote:
            "Showtec Performer Profile 650 Q5, order code 33064. " +
            "8-channel SIMPLE DMX personality. Beam angle depends on fitted lens."
    }
},

"Showtec Performer 1500 Fresnel Q6 (8ch SSP)": {
    type: "rgbalc",
    channels: 8,

    map: {
        dimmer: 0,
        intensity: 0,

        r: 1,
        g: 2,
        b: 3,
        a: 4,
        l: 5,
        c: 6,

        colorPreset: 7
    },

    photometrics: {
        verified: true,
        sourceType: "LED",

        ratedLumens: 3111,
        beamAngle: 10,
        beamAngleMin: 10,
        beamAngleMax: 50,

        outputScale: 1.00,

        colourTemperature: {
            min: 1800,
            max: 8000
        },

        sourcePowerWatts: 100,

        manufacturer: "Showtec",
        model: "Performer 1500 Fresnel Q6",

        sourceNote:
            "Showtec Performer 1500 Fresnel Q6, order code 33130. " +
            "8-channel SSP DMX personality. RGBALC LED engine."
    }
},

"Showtec Performer Profile 650 Q5 (17ch COLOR 16BIT)": {
    type: "rgbal",
    channels: 17,

    map: {
        dimmer: 0,
        intensity: 0,
        dimmerFine: 1,

        r: 2,
        rFine: 3,

        g: 4,
        gFine: 5,

        b: 6,
        bFine: 7,

        a: 8,
        aFine: 9,

        l: 10,
        lFine: 11,

        presetColors: 12,
        colorMacros: 13,

        strobe: 14,
        dimmerSpeed: 15,
        performance: 16
    },

    photometrics: {
        verified: true,
        sourceType: "LED",

        ratedLumens: null,

        beamAngle: null,
        beamAngleMin: 15,
        beamAngleMax: 50,

        outputScale: 1.00,

        sourcePowerWatts: 240,

        manufacturer: "Showtec",
        model: "Performer Profile 650 Q5",

        sourceNote:
            "Showtec Performer Profile 650 Q5, order code 33064. " +
            "17-channel COLOR 16BIT DMX personality. " +
            "Channels 3-12 provide 16-bit RGBAL colour control."
    }
},


    "Showtec Performer 2000 RGBAL (19ch TR16)": {
        type: "rgb",
        channels: 19,
        map: {
            dimmer: 0,
            intensity: 0,
            dimmerFine: 1,
            r: 2,
            rFine: 3,
            g: 4,
            gFine: 5,
            b: 6,
            bFine: 7,
            amber: 8,
            amberFine: 9,
            lime: 10,
            limeFine: 11,
            cyan: 12,
            cyanFine: 13,
            magenta: 14,
            magentaFine: 15,
            yellow: 16,
            preset: 17,
            strobe: 18
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 5500,

            /*
             * Manufacturer specifies a motorised zoom:
             * 15° - 45°.
             */
            beamAngle: null,
            beamAngleMin: 15,
            beamAngleMax: 45,

            outputScale: 1.00,

            colourTemperatureMin: 2700,
            colourTemperatureMax: 8000,

            sourcePowerWatts: 240
        }
    },


    "Showtec Performer 1500 Fresnel Q6 (20ch TR16)": {
        type: "rgb",
        channels: 20,
        map: {
            dimmer: 0,
            intensity: 0,
            dimmerFine: 1,
            r: 2,
            rFine: 3,
            g: 4,
            gFine: 5,
            b: 6,
            bFine: 7,
            amber: 8,
            amberFine: 9,
            lime: 10,
            limeFine: 11,
            cyan: 12,
            cyanFine: 13,
            preset: 14,
            cct: 15,
            auto: 16,
            speed: 17,
            strobe: 18,
            control: 19
        },

        photometrics: {
            /*
             * Exact Q6 total lumen figure was not established
             * sufficiently from the manufacturer material found.
             */
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * PERFORMER PROFILE 700 Q6
     * ========================================================
     *
     * Manufacturer:
     *
     * Total luminous flux = 10,276 lm
     * Red                = 1,289 lm
     * Green              = 2,119 lm
     * Blue               =   295 lm
     * Amber              = 1,720 lm
     * Lime               = 3,756 lm
     * Cyan               =   857 lm
     *
     * CCT = 1800 K - 10000 K
     *
     * The fixture uses interchangeable lenses, so a single
     * beam angle should NOT be hard-coded as 25°.
     */

    "Showtec Performer Profile 700 Q6 (BASIC 3ch)": {
        type: "rgb",
        channels: 3,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 10276,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00,

            colourTemperatureMin: 1800,
            colourTemperatureMax: 10000,

            sourcePowerWatts: 300,

            channelLumens: {
                red: 1289,
                green: 2119,
                blue: 295,
                amber: 1720,
                lime: 3756,
                cyan: 857
            }
        }
    },


    "Showtec Performer Profile 700 Q6 (SSP 8ch)": {
        type: "rgb",
        channels: 8,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            amber: 4,
            lime: 5,
            cyan: 6,
            magenta: 7
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 10276,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00,

            colourTemperatureMin: 1800,
            colourTemperatureMax: 10000,

            sourcePowerWatts: 300,

            channelLumens: {
                red: 1289,
                green: 2119,
                blue: 295,
                amber: 1720,
                lime: 3756,
                cyan: 857
            }
        }
    },


    "Showtec Performer Profile 700 Q6 (TOUR 13ch)": {
        type: "rgb",
        channels: 13,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            amber: 4,
            lime: 5,
            cyan: 6,
            magenta: 7,
            yellow: 8,
            preset: 9,
            strobe: 10,
            speed: 11,
            effect: 12
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 10276,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00,

            colourTemperatureMin: 1800,
            colourTemperatureMax: 10000,

            sourcePowerWatts: 300,

            channelLumens: {
                red: 1289,
                green: 2119,
                blue: 295,
                amber: 1720,
                lime: 3756,
                cyan: 857
            }
        }
    },


    "Showtec Performer Profile 700 Q6 (TR16 20ch)": {
        type: "rgb",
        channels: 20,
        map: {
            dimmer: 0,
            intensity: 0,
            dimmerFine: 1,
            r: 2,
            rFine: 3,
            g: 4,
            gFine: 5,
            b: 6,
            bFine: 7,
            amber: 8,
            amberFine: 9,
            lime: 10,
            limeFine: 11,
            cyan: 12,
            cyanFine: 13,
            magenta: 14,
            yellow: 15,
            preset: 16,
            strobe: 17,
            speed: 18,
            control: 19
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 10276,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00,

            colourTemperatureMin: 1800,
            colourTemperatureMax: 10000,

            sourcePowerWatts: 300,

            channelLumens: {
                red: 1289,
                green: 2119,
                blue: 295,
                amber: 1720,
                lime: 3756,
                cyan: 857
            }
        }
    },


    /*
     * ========================================================
     * SHOWTEC PHANTOM
     * ========================================================
     */

    "Showtec Phantom 50 Spot (11ch)": {
        type: "moving",
        channels: 11,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            r: 6,
            g: 7,
            b: 8,
            w: 9,
            gobo: 10
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        }
    },


    "Showtec Phantom 50 Spot (8ch)": {
        type: "moving",
        channels: 8,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            colour: 4,
            gobo: 5,
            focus: 6,
            speed: 7
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Showtec Phantom 130 (13ch)": {
        type: "moving",
        channels: 13,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            r: 6,
            g: 7,
            b: 8,
            w: 9,
            amber: 10,
            gobo: 11,
            prism: 12
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 5200,
            beamAngle: null,
            beamAngleMin: 12,
            beamAngleMax: 21,
            outputScale: 1.00,
            sourcePowerWatts: 130
        }
    },


    "Showtec Phantom 130 (10ch)": {
        type: "moving",
        channels: 10,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            colour: 4,
            gobo: 5,
            prism: 6,
            focus: 7,
            zoom: 8,
            speed: 9
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 5200,
            beamAngle: null,
            beamAngleMin: 12,
            beamAngleMax: 21,
            outputScale: 1.00,
            sourcePowerWatts: 130
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    /*
     * The Phantom 7R uses a discharge source.
     *
     * Exact fixture-level luminous flux could not be safely
     * equated to the lamp's nominal output, so it is left
     * unverified rather than using the old guessed 15,000 lm.
     */

    "Showtec Phantom 7R (16ch)": {
        type: "moving",
        channels: 16,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            r: 6,
            g: 7,
            b: 8,
            w: 9,
            gobo: 10,
            gobo2: 11,
            zoom: 12,
            rot: 13,
            shake: 14,
            speed: 15
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        }
    },


    "Showtec Phantom 7R (14ch)": {
        type: "moving",
        channels: 14,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            colour: 4,
            gobo: 5,
            gobor: 6,
            prism: 7,
            prismr: 8,
            focus: 9,
            zoom: 10,
            rot: 11,
            effect: 12,
            speed: 13
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    /*
     * Phantom 12R:
     *
     * Manufacturer fixture specification:
     * 8600 lm
     * 2.2° - 48.8°
     *
     * The replacement NSL300 lamp itself is specified at
     * up to 19,000 lm, but that is NOT used as fixture output.
     */

    "Showtec Phantom 12R (18ch)": {
        type: "moving",
        channels: 18,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            colour: 6,
            colourr: 7,
            gobo: 8,
            gobor: 9,
            gobo2: 10,
            gobo2r: 11,
            prism: 12,
            prismr: 13,
            focus: 14,
            zoom: 15,
            frost: 16,
            iris: 17
        },

        photometrics: {
            verified: true,
            sourceType: "DISCHARGE",
            ratedLumens: 8600,
            beamAngle: null,
            beamAngleMin: 2.2,
            beamAngleMax: 48.8,
            outputScale: 1.00,
            sourcePowerWatts: 300,
            colourTemperature: 7200
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Showtec Phantom 12R (20ch)": {
        type: "moving",
        channels: 20,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            colour: 6,
            colourr: 7,
            gobo: 8,
            gobor: 9,
            gobo2: 10,
            gobo2r: 11,
            prism: 12,
            prismr: 13,
            focus: 14,
            zoom: 15,
            frost: 16,
            iris: 17,
            effect: 18,
            speed: 19
        },

        photometrics: {
            verified: true,
            sourceType: "DISCHARGE",
            ratedLumens: 8600,
            beamAngle: null,
            beamAngleMin: 2.2,
            beamAngleMax: 48.8,
            outputScale: 1.00,
            sourcePowerWatts: 300,
            colourTemperature: 7200
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Showtec Phantom 12R (16ch)": {
        type: "moving",
        channels: 16,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            colour: 4,
            colourr: 5,
            gobo: 6,
            gobor: 7,
            prism: 8,
            prismr: 9,
            focus: 10,
            zoom: 11,
            frost: 12,
            iris: 13,
            effect: 14,
            speed: 15
        },

        photometrics: {
            verified: true,
            sourceType: "DISCHARGE",
            ratedLumens: 8600,
            beamAngle: null,
            beamAngleMin: 2.2,
            beamAngleMax: 48.8,
            outputScale: 1.00,
            sourcePowerWatts: 300,
            colourTemperature: 7200
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    /*
     * ========================================================
     * SHOWTEC WASH
     * ========================================================
     *
     * Exact manufacturer photometric figures for these
     * particular models were not sufficiently established.
     */

    "Showtec Wipe 100 (8ch)": {
        type: "moving",
        channels: 8,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            r: 4,
            g: 5,
            b: 6,
            w: 7
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        }
    },


    "Showtec Wipe 150 (10ch)": {
        type: "moving",
        channels: 10,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            r: 4,
            g: 5,
            b: 6,
            w: 7,
            amber: 8,
            uv: 9
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        }
    },


    "Showtec Helix S50 (4ch RGBW)": {
        type: "rgbw",
        channels: 4,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Showtec Helix S100 (5ch)": {
        type: "rgbw",
        channels: 5,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Showtec Helix S150 (6ch)": {
        type: "rgbw",
        channels: 6,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4,
            strobe: 5
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * LPC 120
     * ========================================================
     *
     * These names correspond to the LPC120 family but the
     * exact manufacturer photometric figures were not
     * sufficiently established from the available material.
     */

    "LPC 120 (4ch RGBW)": {
        type: "rgbw",
        channels: 4,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "LPC 120 (8ch Master)": {
        type: "rgbw",
        channels: 8,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4,
            strobe: 5,
            speed: 6,
            colmacro: 7
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * COMPACT PAR
     * ========================================================
     */

    "Showtec Compact Par 7 (3ch RGB)": {
        type: "rgb",
        channels: 3,
        map: {
            r: 0,
            g: 1,
            b: 2
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Showtec Compact Par 12 (4ch RGBW)": {
        type: "rgbw",
        channels: 4,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Showtec Compact Par 18 (5ch)": {
        type: "rgbw",
        channels: 5,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 4997,
            beamAngle: 15,
            outputScale: 1.00,
            sourcePowerWatts: 126
        }
    },


    /*
     * LED Par 64 Quad exact manufacturer photometrics not
     * sufficiently established.
     */

    "Showtec LED Par 64 Quad (5ch)": {
        type: "rgbw",
        channels: 5,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Showtec LED Par 64 Quad (4ch)": {
        type: "rgbw",
        channels: 4,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * SUNSTRIP / STROBE
     * ========================================================
     */

    "Showtec Sunstrip 10": {
        type: "dimmer",
        channels: 10,
        map: {
            dimmer: 0,
            intensity: 0
        },

        photometrics: {
            verified: false,
            sourceType: "TUNGSTEN",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Showtec Sunstrip 20": {
        type: "dimmer",
        channels: 20,
        map: {
            dimmer: 0,
            intensity: 0
        },

        photometrics: {
            verified: false,
            sourceType: "TUNGSTEN",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Showtec Atomic 3000 (4ch)": {
        type: "strobe",
        channels: 4,
        map: {
            dimmer: 0,
            intensity: 0,
            speed: 1,
            colour: 2,
            zone: 3
        },

        photometrics: {
            verified: false,
            sourceType: "STROBE",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 64, rgb: [1, 1, 1], hue: 0 },
            { min: 65, max: 127, rgb: [1, 0, 0], hue: 0 },
            { min: 128, max: 191, rgb: [0, 1, 0], hue: 120 },
            { min: 192, max: 255, rgb: [0, 0, 1], hue: 240 }
        ]
    },


    /*
     * ========================================================
     * BETOPPER MOVING LIGHTS
     * ========================================================
     *
     * The exact Betopper model numbers in the original library
     * could not all be tied to manufacturer-published
     * photometric data.
     *
     * Therefore these DO NOT retain the previous invented
     * lumen figures.
     */

    "Betopper SPOT 60 (10ch)": {
        type: "moving",
        channels: 10,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            r: 4,
            g: 5,
            b: 6,
            w: 7,
            gobo: 8,
            speed: 9
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Betopper SPOT 230 7R (16ch)": {
        type: "moving",
        channels: 16,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            colour: 6,
            gobo: 7,
            gobor: 8,
            prism: 9,
            prismr: 10,
            focus: 11,
            zoom: 12,
            frost: 13,
            iris: 14,
            speed: 15
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Betopper SPOT 230 7R (14ch)": {
        type: "moving",
        channels: 14,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            colour: 4,
            gobo: 5,
            gobor: 6,
            prism: 7,
            prismr: 8,
            focus: 9,
            zoom: 10,
            effect: 11,
            macro: 12,
            speed: 13
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Betopper SPOT 260 9R (18ch)": {
        type: "moving",
        channels: 18,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            colour: 6,
            colourr: 7,
            gobo: 8,
            gobor: 9,
            prism: 10,
            prismr: 11,
            focus: 12,
            zoom: 13,
            frost: 14,
            iris: 15,
            effect: 16,
            speed: 17
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Betopper SPOT 350 17R (20ch)": {
        type: "moving",
        channels: 20,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            colour: 6,
            colourr: 7,
            gobo: 8,
            gobor: 9,
            gobo2: 10,
            gobo2r: 11,
            prism: 12,
            prismr: 13,
            focus: 14,
            zoom: 15,
            frost: 16,
            iris: 17,
            effect: 18,
            speed: 19
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Betopper BEAM 350 17R (20ch)": {
        type: "moving",
        channels: 20,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            colour: 6,
            colourr: 7,
            gobo: 8,
            gobor: 9,
            gobo2: 10,
            gobo2r: 11,
            prism: 12,
            prismr: 13,
            focus: 14,
            zoom: 15,
            frost: 16,
            iris: 17,
            effect: 18,
            speed: 19
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Betopper BEAM 230 7R (16ch)": {
        type: "moving",
        channels: 16,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            panf: 4,
            tiltf: 5,
            colour: 6,
            gobo: 7,
            gobor: 8,
            prism: 9,
            prismr: 10,
            focus: 11,
            zoom: 12,
            rot: 13,
            shake: 14,
            speed: 15
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Betopper BEAM 230 7R (12ch)": {
        type: "moving",
        channels: 12,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            colour: 4,
            gobo: 5,
            prism: 6,
            focus: 7,
            zoom: 8,
            rot: 9,
            effect: 10,
            speed: 11
        },

        photometrics: {
            verified: false,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 25, rgb: [1, 1, 1], hue: 0 },
            { min: 26, max: 50, rgb: [1, 0, 0], hue: 0 },
            { min: 51, max: 75, rgb: [1, 0.5, 0], hue: 30 },
            { min: 76, max: 100, rgb: [1, 1, 0], hue: 60 },
            { min: 101, max: 125, rgb: [0, 1, 0], hue: 120 },
            { min: 126, max: 150, rgb: [0, 1, 1], hue: 180 },
            { min: 151, max: 175, rgb: [0, 0, 1], hue: 240 },
            { min: 176, max: 200, rgb: [0.5, 0, 1], hue: 270 },
            { min: 201, max: 225, rgb: [1, 0, 1], hue: 300 },
            { min: 226, max: 255, rgb: [1, 1, 1], hue: 0 }
        ]
    },


    "Betopper WASH 120 (12ch)": {
        type: "moving",
        channels: 12,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            r: 4,
            g: 5,
            b: 6,
            w: 7,
            amber: 8,
            uv: 9,
            zoom: 10,
            speed: 11
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        }
    },


    "Betopper WASH 280 (16ch)": {
        type: "moving",
        channels: 16,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            r: 4,
            g: 5,
            b: 6,
            w: 7,
            amber: 8,
            uv: 9,
            zoom: 10,
            frost: 11,
            focus: 12,
            prism: 13,
            speed: 14,
            macro: 15
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: null,
            beamAngleMax: null,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * BETOPPER PARS
     * ========================================================
     */

    "Betopper LED PAR 54x3 (3ch RGB)": {
        type: "rgb",
        channels: 3,
        map: {
            r: 0,
            g: 1,
            b: 2
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00,
            sourcePowerWatts: 162
        }
    },


    "Betopper LED PAR 54x3 (4ch RGBW)": {
        type: "rgbw",
        channels: 4,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00,
            sourcePowerWatts: 162
        }
    },


    "Betopper LED PAR 54x3 (5ch)": {
        type: "rgbw",
        channels: 5,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00,
            sourcePowerWatts: 162
        }
    },


    "Betopper LED PAR 18x12 (4ch)": {
        type: "rgbw",
        channels: 4,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00,
            sourcePowerWatts: 216
        }
    },


    "Betopper LED PAR 18x12 (5ch)": {
        type: "rgbw",
        channels: 5,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00,
            sourcePowerWatts: 216
        }
    },


    /*
     * ========================================================
     * LED BARS
     * ========================================================
     */

    "Betopper LED BAR 24x10 (72ch)": {
        type: "rgb",
        channels: 72,
        map: {
            r: 0,
            g: 1,
            b: 2
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Betopper LED BAR 36x8 (144ch)": {
        type: "rgbw",
        channels: 144,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * BETOPPER STROBES
     * ========================================================
     */

    "Betopper STROBE 2000 (3ch)": {
        type: "strobe",
        channels: 3,
        map: {
            dimmer: 0,
            intensity: 0,
            speed: 1,
            mode: 2
        },

        photometrics: {
            verified: false,
            sourceType: "STROBE",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Betopper STROBE 3000 (4ch)": {
        type: "strobe",
        channels: 4,
        map: {
            dimmer: 0,
            intensity: 0,
            speed: 1,
            colour: 2,
            zone: 3
        },

        photometrics: {
            verified: false,
            sourceType: "STROBE",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        },

        colourWheel: [
            { min: 0, max: 64, rgb: [1, 1, 1], hue: 0 },
            { min: 65, max: 127, rgb: [1, 0, 0], hue: 0 },
            { min: 128, max: 191, rgb: [0, 1, 0], hue: 120 },
            { min: 192, max: 255, rgb: [0, 0, 1], hue: 240 }
        ]
    },


    /*
     * ========================================================
     * FOG / HAZE
     * ========================================================
     *
     * These are atmospheric devices, not light sources.
     * Lumens and beam angle are therefore intentionally absent.
     */

    "Showtec Fog 1500 (2ch)": {
        type: "dimmer",
        channels: 2,
        map: {
            fog: 0,
            fana: 1
        },

        photometrics: {
            verified: true,
            sourceType: "ATMOSPHERIC",
            ratedLumens: 0,
            beamAngle: 0,
            outputScale: 1.00
        }
    },


    "Betopper FOG 1500 (2ch)": {
        type: "dimmer",
        channels: 2,
        map: {
            fog: 0,
            fana: 1
        },

        photometrics: {
            verified: false,
            sourceType: "ATMOSPHERIC",
            ratedLumens: 0,
            beamAngle: 0,
            outputScale: 1.00
        }
    },


    "Betopper HAZE 1500 (3ch)": {
        type: "dimmer",
        channels: 3,
        map: {
            haze: 0,
            fana: 1,
            fluid: 2
        },

        photometrics: {
            verified: false,
            sourceType: "ATMOSPHERIC",
            ratedLumens: 0,
            beamAngle: 0,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * GENERIC
     * ========================================================
     *
     * Generic fixtures are intentionally NOT treated as
     * manufacturer fixtures.
     */

    "Generic Dimmer": {
        type: "dimmer",
        channels: 1,
        map: {
            dimmer: 0,
            intensity: 0
        },

        photometrics: {
            verified: false,
            sourceType: "UNKNOWN",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Generic RGB": {
        type: "rgb",
        channels: 3,
        map: {
            r: 0,
            g: 1,
            b: 2
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Generic RGBW": {
        type: "rgbw",
        channels: 4,
        map: {
            r: 0,
            g: 1,
            b: 2,
            w: 3
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Generic 6ch (Dimmer/R/G/B/W/Strobe)": {
        type: "rgbw",
        channels: 6,
        map: {
            dimmer: 0,
            intensity: 0,
            r: 1,
            g: 2,
            b: 3,
            w: 4,
            strobe: 5
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Generic Moving 8ch": {
        type: "moving",
        channels: 8,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            pan: 2,
            tilt: 3,
            r: 4,
            g: 5,
            b: 6,
            w: 7
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    },


    "Generic Strobe": {
        type: "strobe",
        channels: 2,
        map: {
            dimmer: 0,
            intensity: 0,
            speed: 1
        },

        photometrics: {
            verified: false,
            sourceType: "STROBE",
            ratedLumens: null,
            beamAngle: null,
            outputScale: 1.00
        }
    }
};


/*
 * ============================================================
 * PHOTOMETRIC HELPERS
 * ============================================================
 */

const DEFAULT_PHOTOMETRICS = {
    verified: false,
    sourceType: "UNKNOWN",
    ratedLumens: null,
    beamAngle: null,
    beamAngleMin: null,
    beamAngleMax: null,
    outputScale: 1.0
};


/**
 * Get the photometric profile for a fixture.
 */
function getFixturePhotometrics(fixtureOrName) {

    let def = null;

    if (typeof fixtureOrName === "string") {

        def =
            FixtureLibrary[
                fixtureOrName
            ];

    } else if (
        fixtureOrName &&
        fixtureOrName.name
    ) {

        def =
            FixtureLibrary[
                fixtureOrName.name
            ];
    }

    if (!def) {

        return {
            ...DEFAULT_PHOTOMETRICS
        };
    }

    return {
        ...DEFAULT_PHOTOMETRICS,
        ...(def.photometrics || {})
    };
}


/**
 * Return whether the fixture has a verified
 * manufacturer lumen figure.
 */
function hasVerifiedPhotometrics(
    fixtureOrName
) {

    const p =
        getFixturePhotometrics(
            fixtureOrName
        );

    return (
        p.verified === true &&
        typeof p.ratedLumens === "number" &&
        p.ratedLumens >= 0
    );
}


/**
 * Calculate relative physical output.
 *
 * IMPORTANT:
 *
 * If no manufacturer lumen value exists,
 * this function returns 0 rather than inventing
 * a photometric output.
 */
function calculateFixtureOutput(
    fixtureOrName,
    intensity = 100
) {

    const p =
        getFixturePhotometrics(
            fixtureOrName
        );

    if (
        typeof p.ratedLumens !==
        "number"
    ) {
        return 0;
    }

    const d =
        Math.max(
            0,
            Math.min(
                100,
                Number(intensity) || 0
            )
        ) / 100;

    /*
     * Approximate lighting dimmer response.
     *
     * This remains a VISUALISATION model.
     * It is not a manufacturer dimming curve.
     */
    const dimmerResponse =
        Math.pow(d, 1.8);

    return (
        p.ratedLumens *
        dimmerResponse *
        (
            Number(p.outputScale) || 1
        )
    );
}


/**
 * Calculate beam spread.
 *
 * For zoom fixtures, pass the actual beam angle being used.
 */
function calculateBeamRadius(
    distance,
    beamAngle
) {

    const d =
        Math.max(
            0,
            Number(distance) || 0
        );

    const angle =
        Math.max(
            0.1,
            Number(beamAngle) || 30
        );

    return (
        d *
        Math.tan(
            (angle * Math.PI / 180) / 2
        )
    );
}


/**
 * Get a sensible beam angle for rendering.
 *
 * If the fixture has a fixed angle, use it.
 *
 * If it has a zoom range, use the supplied zoom
 * value when available.
 */
function getFixtureBeamAngleForRender(
    fixtureOrName,
    zoom = null
) {

    const p =
        getFixturePhotometrics(
            fixtureOrName
        );

    if (
        typeof p.beamAngle ===
        "number"
    ) {
        return p.beamAngle;
    }

    if (
        typeof p.beamAngleMin ===
            "number" &&
        typeof p.beamAngleMax ===
            "number"
    ) {

        /*
         * If no zoom is supplied, use the middle
         * of the manufacturer's range.
         */
        const z =
            zoom === null
                ? 0.5
                : Math.max(
                    0,
                    Math.min(
                        1,
                        Number(zoom) || 0
                    )
                );

        return (
            p.beamAngleMin +
            (
                p.beamAngleMax -
                p.beamAngleMin
            ) * z
        );
    }

    return null;
}


/**
 * Calculate approximate illuminance.
 *
 * This only works when a verified lumen figure
 * and beam angle are available.
 */
function calculateApproxLux(
    fixtureOrName,
    intensity = 100,
    distance = 5,
    beamAngleOverride = null
) {

    const p =
        getFixturePhotometrics(
            fixtureOrName
        );

    const lumens =
        calculateFixtureOutput(
            fixtureOrName,
            intensity
        );

    if (
        !hasVerifiedPhotometrics(
            fixtureOrName
        )
    ) {
        return 0;
    }

    const d =
        Math.max(
            0.1,
            Number(distance) || 0.1
        );

    const beamDegrees =
        beamAngleOverride !== null

            ? Number(
                beamAngleOverride
            )

            : getFixtureBeamAngleForRender(
                fixtureOrName
            );

    /*
     * No verified beam angle means
     * we cannot produce a meaningful
     * cone-based lux approximation.
     */
    if (
        !Number.isFinite(
            beamDegrees
        ) ||
        beamDegrees <= 0
    ) {
        return 0;
    }

    const halfAngle =
        (
            beamDegrees *
            Math.PI /
            180
        ) / 2;

    /*
     * Solid angle of a cone:
     *
     * Ω = 2π(1-cosθ)
     */
    const solidAngle =
        2 *
        Math.PI *
        (
            1 -
            Math.cos(
                halfAngle
            )
        );

    const candela =
        lumens /
        Math.max(
            0.001,
            solidAngle
        );

    return (
        candela /
        (d * d)
    );
}


/*
 * ============================================================
 * FIXTURE INTENSITY / OUTPUT API
 * ============================================================
 */

function getFixtureOutputScale(
    fixtureOrName
) {

    return getFixturePhotometrics(
        fixtureOrName
    ).outputScale;
}


function getFixtureRatedLumens(
    fixtureOrName
) {

    return getFixturePhotometrics(
        fixtureOrName
    ).ratedLumens;
}


function getFixtureBeamAngle(
    fixtureOrName
) {

    return getFixturePhotometrics(
        fixtureOrName
    ).beamAngle;
}


/*
 * ============================================================
 * LIBRARY UI
 * ============================================================
 */

function renderLibrary(filter = "") {

    const list =
        $("libList");

    if (!list) return;

    list.innerHTML = "";

    const q =
        String(filter)
            .toLowerCase()
            .trim();

    Object.entries(
        FixtureLibrary
    )

        .filter(
            ([name]) =>
                name
                    .toLowerCase()
                    .includes(q)
        )

        .forEach(
            ([name, def]) => {

                const el =
                    document.createElement(
                        "div"
                    );

                el.className =
                    "fixture-item";

                const p =
                    getFixturePhotometrics(
                        name
                    );

                let output = "";

                if (
                    typeof p.ratedLumens ===
                    "number"
                ) {

                    output =
                        `${Math.round(
                            p.ratedLumens / 1000
                        )}k lm`;

                } else {

                    output =
                        "photometrics unverified";
                }

                el.innerHTML = `
                    <span>${name}</span>

                    <span style="
                        font-size:10px;
                        color:var(--text-muted);
                    ">
                        ${def.channels}ch
                        · ${output}
                    </span>
                `;

                el.onclick = () => {

                    if ($("patchName")) {

                        $("patchName")
                            .value =
                            name;
                    }

                    if ($("patchType")) {

                        $("patchType")
                            .value =
                            def.type;
                    }

                    if (
                        typeof log ===
                        "function"
                    ) {

                        const beam =
                            getFixtureBeamAngleForRender(
                                name
                            );

                        const beamText =
                            beam === null
                                ? "beam not verified"
                                : `${beam}° beam`;

                        const lumenText =
                            typeof p.ratedLumens ===
                            "number"

                                ? `${Math.round(
                                    p.ratedLumens
                                )} lm`

                                : "manufacturer lumen figure unavailable";

                        log(
                            `Selected: ${name} ` +
                            `(${def.channels}ch · ` +
                            `${lumenText} · ` +
                            `${beamText})`
                        );
                    }
                };

                list.appendChild(el);
            }
        );
}


/*
 * ============================================================
 * FIXTURE LIST
 * ============================================================
 */

function renderFixtures() {

    const list =
        $("fixtureList");

    const count =
        $("selCount");

    if (!list) return;

    list.innerHTML = "";

    if (
        !(State.selected instanceof Set)
    ) {

        State.selected =
            new Set();
    }

    if (
        !(State.fixtureStates instanceof Map)
    ) {

        State.fixtureStates =
            new Map();
    }

    State.fixtures.forEach(
        (f, idx) => {

            if (!f) return;

            const selected =
                State.selected.has(
                    f.id
                );

            let state =
                State.fixtureStates.get(
                    f.id
                );

            if (!state) {

                state =
                    typeof createFixtureState ===
                    "function"

                        ? createFixtureState(
                            State.current || {}
                        )

                        : {
                            ...(State.current || {}),
                            intensity: 100,
                            master: 100,
                            pan: 128,
                            tilt: 128,
                            zoom: 0
                        };

                State.fixtureStates.set(
                    f.id,
                    state
                );
            }

            const intensity =
                Number(
                    state.intensity ??
                    state.dimmer ??
                    100
                );

            const p =
                getFixturePhotometrics(
                    f.name
                );

            const output =
                calculateFixtureOutput(
                    f.name,
                    intensity
                );

            const el =
                document.createElement(
                    "div"
                );

            el.className =
                `fixture-item ${
                    selected ? "sel" : ""
                }`;

            let outputText;

            if (
                typeof p.ratedLumens ===
                "number"
            ) {

                outputText =
                    `${Math.round(
                        output
                    )} lm`;

            } else {

                outputText =
                    "manufacturer output unavailable";
            }

            el.innerHTML = `
                <span>
                    ${idx + 1}. ${f.name}
                </span>

                <span style="
                    font-size:10px;
                    color:var(--text-muted);
                ">
                    Uni ${f.uni}
                    · Addr ${f.addr}
                    · ${Math.round(intensity)}%
                    · ${outputText}
                </span>
            `;

            el.onclick = e => {

                if (e.shiftKey) {

                    State.selected.has(
                        f.id
                    )

                        ? State.selected.delete(
                            f.id
                        )

                        : State.selected.add(
                            f.id
                        );

                } else {

                    State.selected.clear();

                    State.selected.add(
                        f.id
                    );
                }

                State.selectedFixtureId =
                    f.id;

                renderFixtures();

                if (
                    typeof updateControlVisibility ===
                    "function"
                ) {

                    updateControlVisibility();
                }

                if (
                    typeof updateDMX ===
                    "function"
                ) {

                    updateDMX();
                }
            };

            list.appendChild(el);
        }
    );

    if (count) {

        count.textContent =
            `(${State.selected.size} selected)`;
    }

    if (
        typeof updateControlVisibility ===
        "function"
    ) {

        updateControlVisibility();
    }
}


/*
 * ============================================================
 * VALIDATION
 * ============================================================
 */

function validateFixtureLibrary() {

    let errors = 0;

    let verified =
        0;

    let unverified =
        0;

    Object.entries(
        FixtureLibrary
    )

        .forEach(
            ([name, def]) => {

                /*
                 * Channel count
                 */
                if (
                    !Number.isInteger(
                        def.channels
                    ) ||
                    def.channels < 1 ||
                    def.channels > 512
                ) {

                    console.error(
                        `[FixtureLibrary] ${name}: ` +
                        `invalid channel count`
                    );

                    errors++;
                }


                /*
                 * DMX map
                 */
                if (
                    def.map &&
                    typeof def.map ===
                        "object"
                ) {

                    Object.entries(
                        def.map
                    )

                        .forEach(
                            ([key, channel]) => {

                                if (
                                    !Number.isInteger(
                                        channel
                                    ) ||
                                    channel < 0 ||
                                    channel >=
                                        def.channels
                                ) {

                                    console.error(
                                        `[FixtureLibrary] ${name}: ` +
                                        `${key} points to channel ` +
                                        `${channel} but fixture has ` +
                                        `${def.channels} channels`
                                    );

                                    errors++;
                                }
                            }
                        );
                }


                /*
                 * Dimmer/intensity aliases
                 */
                if (
                    def.map &&
                    def.map.dimmer !==
                        undefined &&
                    def.map.intensity !==
                        undefined &&
                    def.map.dimmer !==
                        def.map.intensity
                ) {

                    console.error(
                        `[FixtureLibrary] ${name}: ` +
                        `dimmer/intensity mismatch`
                    );

                    errors++;
                }


                /*
                 * Photometric validation
                 */
                if (def.photometrics) {

                    const p =
                        def.photometrics;

                    if (
                        p.verified === true
                    ) {

                        verified++;

                    } else {

                        unverified++;
                    }


                    /*
                     * ratedLumens may intentionally
                     * be null when no manufacturer
                     * figure is available.
                     */
                    if (
                        p.ratedLumens !==
                            null &&
                        (
                            typeof p.ratedLumens !==
                                "number" ||
                            p.ratedLumens < 0
                        )
                    ) {

                        console.error(
                            `[FixtureLibrary] ${name}: ` +
                            `invalid ratedLumens`
                        );

                        errors++;
                    }


                    /*
                     * Fixed beam angle.
                     */
                    if (
                        p.beamAngle !==
                            null &&
                        (
                            typeof p.beamAngle !==
                                "number" ||
                            p.beamAngle <= 0 ||
                            p.beamAngle > 180
                        )
                    ) {

                        console.error(
                            `[FixtureLibrary] ${name}: ` +
                            `invalid beamAngle`
                        );

                        errors++;
                    }


                    /*
                     * Zoom range.
                     */
                    if (
                        p.beamAngleMin !==
                            null &&
                        (
                            typeof p.beamAngleMin !==
                                "number" ||
                            p.beamAngleMin <= 0 ||
                            p.beamAngleMin > 180
                        )
                    ) {

                        console.error(
                            `[FixtureLibrary] ${name}: ` +
                            `invalid beamAngleMin`
                        );

                        errors++;
                    }


                    if (
                        p.beamAngleMax !==
                            null &&
                        (
                            typeof p.beamAngleMax !==
                                "number" ||
                            p.beamAngleMax <= 0 ||
                            p.beamAngleMax > 180
                        )
                    ) {

                        console.error(
                            `[FixtureLibrary] ${name}: ` +
                            `invalid beamAngleMax`
                        );

                        errors++;
                    }


                    if (
                        typeof p.beamAngleMin ===
                            "number" &&
                        typeof p.beamAngleMax ===
                            "number" &&
                        p.beamAngleMin >
                            p.beamAngleMax
                    ) {

                        console.error(
                            `[FixtureLibrary] ${name}: ` +
                            `beam angle range is reversed`
                        );

                        errors++;
                    }


                    if (
                        typeof p.outputScale !==
                            "number" ||
                        p.outputScale <= 0
                    ) {

                        console.error(
                            `[FixtureLibrary] ${name}: ` +
                            `invalid outputScale`
                        );

                        errors++;
                    }
                }
            }
        );


    if (errors) {

        console.error(
            `[FixtureLibrary] ${errors} error(s) found.`
        );

    } else {

        console.log(
            `[FixtureLibrary] OK — ` +
            `${Object.keys(
                FixtureLibrary
            ).length} fixtures loaded. ` +
            `${verified} verified photometric profiles, ` +
            `${unverified} requiring further manufacturer data.`
        );
    }

    return errors === 0;
}


/*
 * ============================================================
 * GLOBAL EXPORTS
 * ============================================================
 */

window.FixtureLibrary =
    FixtureLibrary;

window.renderLibrary =
    renderLibrary;

window.renderFixtures =
    renderFixtures;

window.getFixturePhotometrics =
    getFixturePhotometrics;

window.hasVerifiedPhotometrics =
    hasVerifiedPhotometrics;

window.calculateFixtureOutput =
    calculateFixtureOutput;

window.calculateApproxLux =
    calculateApproxLux;

window.calculateBeamRadius =
    calculateBeamRadius;

window.getFixtureBeamAngleForRender =
    getFixtureBeamAngleForRender;

window.getFixtureOutputScale =
    getFixtureOutputScale;

window.getFixtureRatedLumens =
    getFixtureRatedLumens;

window.getFixtureBeamAngle =
    getFixtureBeamAngle;


/*
 * ============================================================
 * VALIDATE ON LOAD
 * ============================================================
 */

validateFixtureLibrary();

