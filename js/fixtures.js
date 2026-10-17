
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
            beamAngle: 19,
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
            beamAngle: 30,
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

        beamAngle: 24,
    

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
            speed: 7,
            colmacro: 6
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

    "Chauvet EVE E-50Z (1ch)": {
    type: "dimmer",
    channels: 1,
    map: {
        dimmer: 0,
        intensity: 0
    },
    photometrics: {
        verified: true,
        sourceType: "LED",
        ratedLumens: null,
        beamAngle: 22,
    
        outputScale: 1.00,
        manufacturer: "Chauvet DJ",
        model: "EVE E-50Z"
    }
},

"Chauvet EVE E-50Z (3ch)": {
    type: "dimmer",
    channels: 3,
    map: {
        dimmer: 0,
        intensity: 0,
        strobe: 1,
        dimmerSpeed: 2
    },
    photometrics: {
        verified: true,
        sourceType: "LED",
        ratedLumens: null,
        beamAngle: null,
        beamAngleMin: 20,
        beamAngleMax: 39,
        outputScale: 1.00,
        manufacturer: "Chauvet DJ",
        model: "EVE E-50Z"
    }
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
     * MIRROR BALL MOTOR
     * ========================================================
     *
     * Not a light source (no lumens/beam angle) — a single-channel
     * rotation-speed control for the room's own mirror ball (see
     * S.discoBall in visualizer.html), the same way a fog/haze
     * machine's channel feeds the room's atmosphere rather than
     * producing a beam of its own. 0 = stopped, 1-255 = increasing
     * rotation speed, matching how most real single-channel mirror
     * ball motor controllers work.
     */

    "Mirror Ball Motor (1ch)": {
        type: "dimmer",
        channels: 1,
        map: {
            speed: 0
        },

        photometrics: {
            verified: false,
            sourceType: "MIRROR_BALL_MOTOR",
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


    /*
     * type: "wash" (rather than the plain "moving" above) is what tells
     * the visualizer to draw this with the movingWash archetype — a
     * wider, flatter head — instead of the general-purpose movingHead
     * shell. See fixtureArchetype() in visualizer.html.
     */
    "Generic Moving Wash (9ch)": {
        type: "wash",
        channels: 9,
        map: {
            pan: 0,
            tilt: 1,
            dimmer: 2,
            intensity: 2,
            strobe: 3,
            r: 4,
            g: 5,
            b: 6,
            w: 7,
            zoom: 8
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngleMin: 15,
            beamAngleMax: 45,
            outputScale: 1.00
        }
    },


    /*
     * type: "beam" selects the movingBeam archetype — a small, narrow
     * "gun barrel" head — instead of movingHead. A real beam fixture is
     * usually colour-wheel + gobo rather than RGB, and its beam angle is
     * much tighter than a wash or general spot.
     */
    "Generic Moving Beam (10ch)": {
        type: "beam",
        channels: 10,
        map: {
            pan: 0,
            tilt: 1,
            dimmer: 2,
            intensity: 2,
            strobe: 3,
            colour: 4,
            gobo: 5,
            rot: 6,
            prism: 7,
            focus: 8,
            speed: 9
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: 3,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * LIGHT BAR
     * ========================================================
     *
     * type: "bar" selects the staticBar archetype (visualizer.html) — a
     * long batten drawn with several individual glowing cells along its
     * face. No pan/tilt (a bar is mounted and aimed by hand, not over
     * DMX), and — unlike a real per-pixel LED bar — every cell always
     * shows the SAME colour/intensity: there's no established DMX
     * channel-map convention in this app yet for addressing individual
     * cells, so this represents the common simpler/cheaper kind of bar
     * where the whole fixture is one colour at a time, not a true
     * per-pixel chase controller.
     */
    "Generic LED Bar (6ch)": {
        type: "bar",
        channels: 6,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            r: 2,
            g: 3,
            b: 4,
            w: 5
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: 25,
            outputScale: 1.00
        }
    },


    /*
     * ========================================================
     * BLINDER
     * ========================================================
     *
     * type: "blinder" selects the blinder archetype (visualizer.html) —
     * a compact frame drawn with a grid of separate lamp faces rather
     * than a single panel. Static, no pan/tilt, same single-colour-for-
     * the-whole-fixture note as the LIGHT BAR above.
     */
    "Generic Blinder (5ch)": {
        type: "blinder",
        channels: 5,
        map: {
            dimmer: 0,
            intensity: 0,
            strobe: 1,
            r: 2,
            g: 3,
            b: 4
        },

        photometrics: {
            verified: false,
            sourceType: "LED",
            ratedLumens: null,
            beamAngle: 50,
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
    },

    /*
     * ========================================================
     * HIGH END SYSTEMS
     * ========================================================
     *
     * Full-frame, 4-blade mechanical framing shutter fixtures.
     * Channel map transcribed directly from ETC's own published
     * "SolaFrame 750 DMX Channel Map" reference guide (document
     * 2560M2400, Rev B, released 2021-06, etcconnect.com) —
     * Standard Protocol, channels 1-47. Every channel below is
     * the real one from that document; none were guessed.
     *
     * Each of the 4 shutter blades is controlled by TWO channels
     * ("Angle A" / "Angle B" in the real DMX chart) rather than
     * a single insert + a single rotate channel — the blade is
     * physically actuated at both ends of its edge, so moving A
     * and B equally inserts the blade straight, and moving them
     * unevenly tilts it. Mapped here as blade{1-4}AngleA/B to
     * match the manufacturer's own channel names exactly; the
     * visualiser derives an insert depth and a tilt angle from
     * the A/B pair.
     *
     * NOT YET ACCURATELY RENDERED: this fixture mixes colour via
     * CMY subtraction (Cyan/Magenta/Yellow + CTO) rather than
     * additive RGB. The visualiser has no CMY colour-mixing model
     * yet, so its beam will currently render as plain white/CTO-
     * tinted rather than showing real CMY-mixed colour — the
     * shutter shaping itself is unaffected by this and renders
     * correctly.
     */

    "High End Systems SolaFrame 750": {
        type: "moving",
        channels: 47,
        map: {
            // Coarse/fine pairs — coarse channel first, matching
            // the real document's channel order exactly.
            pan: 0, panf: 1,
            tilt: 2, tiltf: 3,

            // Channel 4 "Color Mode" is a pure enum/mode selector
            // (mix / cycle / random) with no equivalent control in
            // this app's model — intentionally left unmapped, as
            // are every other pure-mode-selector channel below.
            // The physical channel still exists (channels: 47
            // stays correct); it's just not driven by this app yet.
            cyan: 5,
            magenta: 6,
            yellow: 7,
            cto: 8,

            // Real doc channel 10 "Color Wheel Mode" unmapped;
            // channel 11 "Color Wheel" below.
            colour: 10,

            // Real doc channel 12 "Rotating Gobo Wheel Mode"
            // unmapped; channel 13 "Rotating Gobo Wheel" below.
            gobo: 12,
            // Real doc channel 14 "Rotating Gobo Mode" unmapped;
            // channel 15 "Rotating Gobo Coarse" below; channel 16
            // "Rotating Gobo Fine" unmapped.
            gobor: 14,

            shutter1AngleA: 16, shutter1AngleB: 17,
            shutter2AngleA: 18, shutter2AngleB: 19,
            shutter3AngleA: 20, shutter3AngleB: 21,
            shutter4AngleA: 22, shutter4AngleB: 23,

            // Real doc channels 25/26 "Frame Rotation Coarse/Fine"
            // — rotates the whole 4-blade shutter assembly as one
            // unit. Not yet driven by this app (only per-blade
            // angles are); left unmapped rather than wired to the
            // wrong effect. Channel 27 "Animation Mode" — enum,
            // unmapped.

            prism: 27,  // Real doc channel 28 "Prism Mode"
            prismr: 28, // Real doc channel 29 "Prism Rotate Coarse"
            // Real doc channel 30 "Prism Rotate Fine" unmapped.

            frost: 30, // Real doc channel 31 "Diffusion"

            focus: 31, // Real doc channel 32 "Focus Coarse"
            // Real doc channel 33 "Focus Fine" unmapped.
            zoom: 33,  // Real doc channel 34 "Zoom Coarse"
            // Real doc channel 35 "Zoom Fine" unmapped.

            // Real doc channels 36/37 "Auto Focus" / "Auto Focus
            // Adjust" — distance-based autofocus, a different
            // feature from manual Focus above. Unmapped.

            iris: 37, // Real doc channel 38 "Iris"
            // Real doc channel 39 "Strobe Mode" unmapped.
            strobe: 39, // Real doc channel 40 "Strobe"

            dimmer: 40, intensity: 40, // Real doc channel 41 "Dimmer Coarse"
            dimmerFine: 41,            // Real doc channel 42 "Dimmer Fine"

            macro: 42,  // Real doc channel 43 "LED Animations"
            speed: 43,  // Real doc channel 44 "LED Animation Speed"
            effect: 44, // Real doc channel 45 "LED Animation Xfade"

            // Real doc channel 46 "mSpeed" — global movement-speed
            // override, no equivalent control here. Unmapped.

            control: 46 // Real doc channel 47 "Control"
        },

        photometrics: {
            verified: true,
            sourceType: "LED",
            ratedLumens: 11300,

            // Real DMX zoom range for channels 33/34, per the
            // manufacturer's own channel map (this is narrower/
            // wider than the "field angle" figure the spec sheet
            // quotes, which uses a different measurement point).
            beamAngle: null,
            beamAngleMin: 3.8,
            beamAngleMax: 55,

            outputScale: 1.00,

            colourTemperature: 7000,

            // 5.6A @ 100V, per the manufacturer's published
            // electrical spec — watts derived (P = I x V), not an
            // independently published wattage figure.
            sourcePowerWatts: 560,

            manufacturer: "High End Systems",
            model: "SolaFrame 750",

            sourceNote:
                "Channel map from ETC document 2560M2400 Rev B " +
                "(2021-06), 'SolaFrame 750 DMX Channel Map'. " +
                "Lumen/field-angle/power figures from the " +
                "manufacturer's published SolaFrame 750 spec sheet."
        },

        // Real 16-slot indexed colour wheel, transcribed from the
        // same channel map document (Note 1, page 7). Slot ranges
        // are exact; RGB values for the 8 pure-named colours are
        // this app's own approximation of each colour name (no
        // manufacturer swatch/spectral data was published), and
        // the 8 "in-between" slots (the wheel rotating between two
        // adjacent filters) are a 50/50 blend of their neighbours
        // rather than a guessed colour. Those blend slots have no
        // `hue`, so hue-based lookup (picking "red" from the
        // colour-wheel UI) always lands on a pure slot, never a
        // transition one.
        colourWheel: [
            { min: 0,   max: 14,  rgb: [1, 1, 1],       hue: 0 },
            { min: 15,  max: 29,  rgb: [1, .5, .5] },
            { min: 30,  max: 44,  rgb: [1, 0, 0],       hue: 0 },
            { min: 45,  max: 59,  rgb: [.5, 0, .5] },
            { min: 60,  max: 74,  rgb: [0, 0, 1],       hue: 240 },
            { min: 75,  max: 89,  rgb: [0, .5, .5] },
            { min: 90,  max: 104, rgb: [0, 1, 0],       hue: 120 },
            { min: 105, max: 119, rgb: [.5, 1, 0] },
            { min: 120, max: 134, rgb: [1, 1, 0],       hue: 60 },
            { min: 135, max: 149, rgb: [1, .75, 0] },
            { min: 150, max: 164, rgb: [1, .5, 0],      hue: 30 },
            { min: 165, max: 179, rgb: [.75, .25, .5] },
            { min: 180, max: 194, rgb: [.5, 0, 1],      hue: 270 },
            { min: 195, max: 209, rgb: [.25, 0, .75] },
            { min: 210, max: 224, rgb: [0, 0, .5],      hue: 250 },
            { min: 225, max: 239, rgb: [.5, .5, .75] },
            { min: 240, max: 255, rgb: [1, 1, 1],       hue: 0 }
        ]
    },


    /*
     * ========================================================
     * ROBE COLORWASH 1200E AT — 17ch Mode 1
     * ========================================================
     *
     * Correct 17-channel Mode 1 map from the ROBE manual:
     *  1 Pan, 2 Pan Fine, 3 Tilt, 4 Tilt Fine, 5 P/T Speed,
     *  6 Power/Special, 7 P/T Macro, 8 Macro Speed,
     *  9 Cyan, 10 Magenta, 11 Yellow, 12 CTO,
     * 13 Effect Speed, 14 Fresnel Opening, 15 Zoom,
     * 16 Shutter/Strobe, 17 Dimmer.
     *
     * Mode 1 does not contain the colour-wheel channels; those are used
     * by later personalities — an earlier mapping put colour controls on
     * the wrong channels because of this.
     *
     * This fixture's actual DMX-writing behaviour (Mode 1's CMY colour
     * mixing needing an HSL fallback, and its non-standard shutter/
     * strobe DMX ranges) doesn't fit the generic per-fixture writer in
     * js/dmx.js's updateDMX() — see the ROBE COLORWASH 1200E COMPATIBILITY
     * section at the bottom of this file for that fixture-specific logic
     * (formerly its own js/robe-colorwash-1200e.js, folded in here so
     * every piece of this fixture's definition — data and behaviour —
     * lives in one place).
     */
    "Robe ColorWash 1200E AT (17ch Mode 1)": {
        type: "moving",
        channels: 17,
        map: {
            pan: 0,
            panf: 1,
            tilt: 2,
            tiltf: 3,
            speed: 4,
            control: 5,
            macro: 6,
            macroSpeed: 7,
            cyan: 8,
            magenta: 9,
            yellow: 10,
            cto: 11,
            effectSpeed: 12,
            fresnel: 13,
            zoom: 14,
            strobe: 15,
            shutter: 15,
            dimmer: 16,
            intensity: 16
        },

        photometrics: {
            verified: true,
            sourceType: "DISCHARGE",
            ratedLumens: null,
            beamAngle: null,
            beamAngleMin: 13,
            beamAngleMax: 44,
            outputScale: 1,
            manufacturer: "ROBE",
            model: "ColorWash 1200E AT"
        }
    },


    /*
     * ========================================================
     * VARI-LITE VL3000 SPOT — 28ch Enhanced 16-Bit Mode
     * ========================================================
     *
     * Channel map transcribed from Table 3-1 ("VL3000 Spot Luminaire
     * Enhanced 16-Bit Mode") in the official Vari-Lite VL3000 Series
     * Luminaire User's Manual (19-Mar-03, P/N 02.9678.0001) — this is
     * the fixture's ONLY DMX mode, per the same manual.
     *
     * Several real channels are intentionally left unmapped, same
     * reasoning as the SolaFrame 750 entry above — the physical channel
     * still exists (channels: 28 stays correct) but has no equivalent
     * control in this app's model yet:
     *  - Ch 9-11 "Blue/Amber/Magenta Mixer": a true BAM (Blue-Amber-
     *    Magenta) subtractive colour-mixing system, distinct from both
     *    CMY and RGB — this app has no BAM conversion, so colour is
     *    driven through the Color Wheel (ch 12, `colour`) instead.
     *
     * Channel 12's DMX range is NOT one continuous rainbow sweep: per
     * Table 3-6 ("DMX Map for Fixed Color Wheel") in the same manual,
     * only DMX 0-216 are real wheel positions (7 stops — Open plus the
     * 6 named gels from Table 3-5, each documented as an exact single
     * DMX value with a "half" blend position exactly midway to its
     * neighbour on each side); DMX 217-255 SPINS the wheel instead of
     * selecting a colour. An earlier version of this entry had no
     * `colourWheel` below and relied on the generic hue-to-DMX
     * fallback, which spreads picks across the full 0-255 range — over
     * 15% of any pick would land in the spin zone, and even within
     * 0-216 a pick could land on a "half" blend rather than a real
     * gel. `colourWheel` below uses each documented "half" value as the
     * exact boundary between its two neighbouring gels (they're almost
     * perfectly the midpoint between the two solid DMX values on each
     * side — e.g. (0+31)/2=15.5, and the manual's own half position
     * there is 15), so every slot resolves to a real, solid gel.
     *  - Ch 15/18/21 "Lo Byte Gobo N Index/Rot": the fine half of each
     *    16-bit gobo rotation pair — only the coarse byte is driven
     *    (`gobor`/`gobo2r`), same as SolaFrame's gobo rotation fields.
     *  - Ch 19-21 "Gobo Wheel 3" + its index/rotate pair: this app has
     *    no third gobo-wheel field (only gobo/gobo2).
     *  - Ch 24-27 "Focus/Color/Beam/Gobo Time": these set the fixture's
     *    OWN internal transition timing for each mechanism, a different
     *    concept from this app's `speed` field, which has no equivalent
     *    here.
     *
     * Ch 6 "Edge" is mapped to `focus` — Vari-Lite's own name for this
     * fixture's beam-edge sharp/soft control, which is what most other
     * manufacturers simply call focus.
     */
    "Vari-Lite VL3000 Spot (28ch)": {
        type: "moving",
        channels: 28,
        map: {
            dimmer: 0,
            intensity: 0,
            pan: 1,
            panf: 2,
            tilt: 3,
            tiltf: 4,
            focus: 5,
            zoom: 6,
            cto: 7,
            colour: 11,
            gobo: 12,
            gobor: 13,
            gobo2: 15,
            gobo2r: 16,
            iris: 21,
            strobe: 22,
            control: 27
        },

        // Table 3-6 boundaries exactly (see the block comment above):
        // documented "half" DMX values used as the border between each
        // pair of neighbouring gels, so every slot lands on a real,
        // solid colour and 217-255 (spin) is never reachable. RGB
        // values are this app's own approximation of each gel name —
        // Table 3-5 names the filters but the manual doesn't publish
        // swatch/spectral data for them. The two "Open" slots have no
        // `hue` — colourWheelDMX() only ever reaches them through its
        // own low-saturation shortcut (matching on the white [1,1,1]
        // rgb), never through hue-nearest search; giving them hue:0
        // would tie with Deep Red's real hue:0 and — since ties keep
        // whichever the search saw first — a picked red would resolve
        // to white instead.
        colourWheel: [
            { min: 0,   max: 15,  rgb: [1, 1, 1] },
            { min: 16,  max: 48,  rgb: [0, 0.2, 1],     hue: 225 },
            { min: 49,  max: 77,  rgb: [1, 0.5, 0],      hue: 30 },
            { min: 78,  max: 109, rgb: [0, 1, 0.2],     hue: 130 },
            { min: 110, max: 140, rgb: [0.7, 0, 0.5],   hue: 320 },
            { min: 141, max: 171, rgb: [1, 0, 1],       hue: 300 },
            { min: 172, max: 201, rgb: [0.6, 0, 0],       hue: 0 },
            { min: 202, max: 216, rgb: [1, 1, 1] }
        ],

        photometrics: {
            verified: true,
            sourceType: "DISCHARGE",
            ratedLumens: 24000,
            beamAngle: null,
            beamAngleMin: 10,
            beamAngleMax: 60,
            outputScale: 1.00,
            colourTemperature: 6000,

            // Osram HMI 1200 W/S lamp wattage, per the manufacturer's
            // published spec sheet (Appendix F) — not independently
            // measured fixture electrical draw.
            sourcePowerWatts: 1200,

            manufacturer: "Vari-Lite",
            model: "VL3000 Spot",

            sourceNote:
                "Channel map from Table 3-1, Vari-Lite VL3000 Series " +
                "Luminaire User's Manual (19-Mar-03, P/N 02.9678.0001). " +
                "Lamp/lumen/zoom figures from the same manual's " +
                "Appendix F (Technical Specifications): Osram HMI " +
                "1200 W/S metal halide lamp, 6000 K, 85 CRI, 24,000 " +
                "lumens, 10°-60° zoom optics. Color wheel DMX ranges " +
                "from the same manual's Table 3-6 (\"DMX Map for Fixed " +
                "Color Wheel\") and gel names from Table 3-5 (\"Color " +
                "Wheel Standard Configuration Chart\"): Congo Blue, " +
                "Orange, Kelly Green, Dark Fuchsia, Magenta, Deep Red."
        }
    },


    /*
     * ========================================================
     * HIGH END SYSTEMS CYBERLIGHT — 20ch DMX 512 Mode 1
     * ========================================================
     *
     * The original CyberLight — a moving-MIRROR fixture (a stationary
     * lamp/optics assembly steered by a small mirror, not a moving
     * yoke), which is why its pan/tilt range is so much smaller than a
     * moving-head fixture like the two entries above: 170°/110° here
     * versus 540°/270° on the VL3000. Channel map transcribed from
     * Table A-2 ("DMX Assignments Mode 1") in the official High End
     * Systems Cyberlight User Manual — Mode 1 is this fixture's
     * standard 20-channel personality.
     *
     * Colour is real CMY dichroic mixing (`cyan`/`magenta`/`yellow`,
     * channels 6-8) PLUS a separate Color Wheel (channel 5, `colour`)
     * on the real fixture — but this app's colour control for it is
     * exclusively the CMY channels (js/controls.js's primary CMY wheel,
     * shown in place of the main hue/sat wheel for any fixture with
     * real CMY and no RGB — see isCMYSelection there). js/dmx.js skips
     * channel 5 entirely for this fixture (see the hasCMYPrimary check
     * there) rather than driving it at all: an earlier version tracked
     * the picked hue on the wheel too (reasoning a third-party receiver
     * might only look at the wheel channel and ignore CMY), and later a
     * version after that parked it on a constant "open" placeholder
     * instead — but tested against Capture (a real third-party
     * visualizer), BOTH still visibly interfered: its Cyberlight
     * profile has its own separate CMY controls and prioritises the
     * wheel channel over them, so writing anything at all to channel 5
     * made colour changes look like discrete gel picks (or freeze
     * altogether) instead of the real continuous CMY blend. Leaving it
     * untouched (defaults to 0 from State.dmx.fill(0)) is what actually
     * lets Capture's own CMY controls determine colour.
     *
     * High End's own manual calls the gobo wheels "litho" (lithopattern)
     * — Ch 9 "Static Litho" and Ch 10 "Rotating Litho" map to `gobo`/
     * `gobo2` here; Ch 11 "Rotate" (the rotating litho's own speed/
     * position control) maps to `gobo2r`. Ch 15 "Effects Wheel" maps to
     * `effect` — the manual doesn't call it a prism, so it isn't mapped
     * as one.
     */
    "High End Systems Cyberlight (20ch Mode 1)": {
        type: "moving",
        channels: 20,
        map: {
            pan: 0,
            panf: 1,
            tilt: 2,
            tiltf: 3,
            colour: 4,
            cyan: 5,
            magenta: 6,
            yellow: 7,
            gobo: 8,
            gobo2: 9,
            gobo2r: 10,
            zoom: 11,
            focus: 12,
            iris: 13,
            effect: 14,
            frost: 15,
            strobe: 16,
            dimmer: 17,
            intensity: 17,
            speed: 18,
            control: 19
        },

        photometrics: {
            verified: true,
            sourceType: "DISCHARGE",

            // Not independently published in the manual's specification
            // pages for this exact 1200 W lamp configuration — figures
            // seen elsewhere for "CyberLight" online are for a different
            // (2000 W) lamp/optics configuration and would misrepresent
            // this one, so left null per this file's photometrics policy
            // rather than guessed.
            ratedLumens: null,

            beamAngle: null,
            beamAngleMin: 12,
            beamAngleMax: 18,
            outputScale: 1.00,
            colourTemperature: 5600,

            // Fixture's own rated electrical draw (208/230 V, 6.3 A),
            // per the manual's Electrical Specifications — not just the
            // 1200 W lamp itself.
            sourcePowerWatts: 1300,

            manufacturer: "High End Systems",
            model: "Cyberlight",

            sourceNote:
                "Channel map from Table A-2 (\"DMX Assignments Mode " +
                "1\"), High End Systems Cyberlight User Manual. Lamp/" +
                "zoom/electrical figures from the same manual's " +
                "Specifications and Electrical Specifications sections: " +
                "1200 W MSR/MSD metal halide lamp, 5600 K, 750-hour " +
                "rated life, 12°-18° zoom, 208/230 V 6.3 A " +
                "(1300 W rated)."
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

// Clicking a fixture only changes WHICH fixtures are selected — it
// never changes any fixture's own data — so it doesn't need the full
// renderFixtures() rebuild (list.innerHTML = "" + recreate every item,
// re-running photometrics/output lookups for every single patched
// fixture on every click). With a large patch (20-30+ fixtures) that
// full teardown-and-rebuild is expensive enough to visibly flash the
// list when clicking through fixtures, especially quickly. This just
// toggles the "sel" class on the existing elements instead.
function syncFixtureListSelectionClasses() {

    const list =
        $("fixtureList");

    if (!list) return;

    const count =
        $("selCount");

    const selectedIds =
        new Set(
            [...(State.selected instanceof Set ? State.selected : [])].map(String)
        );

    list.querySelectorAll(
        ".fixture-item[data-fixture-id]"
    ).forEach(el => {

        el.classList.toggle(
            "sel",
            selectedIds.has(el.dataset.fixtureId)
        );

    });

    if (count) {

        count.textContent =
            `(${selectedIds.size} selected)`;
    }
}

// Reuses the existing DOM node per fixture (matched by data-fixture-id)
// instead of always tearing down and recreating the whole list. This
// function gets called very often for reasons that never change the
// fixture LIST itself (every MIDI-driven update calls it via
// scheduleMIDIVisualUpdate in midi.js, for instance, to keep the
// displayed intensity/output text fresh) — with a large patch (20-30+
// fixtures), rebuilding every item from scratch on every single one of
// those calls was expensive enough to visibly flash the list, and with
// an active MIDI source connected that could fire dozens of times a
// second, independent of anything the user clicks.
function renderFixtures() {

    const list =
        $("fixtureList");

    const count =
        $("selCount");

    if (!list) return;

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

    const existingById =
        new Map();

    Array.from(
        list.children
    ).forEach(child => {

        if (child.dataset?.fixtureId) {

            existingById.set(
                child.dataset.fixtureId,
                child
            );

        }

    });

    const orderedElements = [];

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

            const html = `
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

            const idKey =
                String(f.id);

            let el =
                existingById.get(idKey);

            if (!el) {

                el =
                    document.createElement(
                        "div"
                    );

                el.dataset.fixtureId =
                    idKey;

            } else {

                existingById.delete(
                    idKey
                );
            }

            const className =
                `fixture-item ${
                    selected ? "sel" : ""
                }`;

            if (el.className !== className) {

                el.className =
                    className;
            }

            if (el.__fixtureListHTML !== html) {

                el.innerHTML = html;
                el.__fixtureListHTML = html;
            }

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

                syncFixtureListSelectionClasses();

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

            orderedElements.push(el);
        }
    );

    // Anything left in existingById belongs to a fixture that's no
    // longer patched — those nodes are simply not re-added below.
    list.replaceChildren(
        ...orderedElements
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


/*
 * ============================================================
 * ROBE COLORWASH 1200E COMPATIBILITY
 * ============================================================
 *
 * The "Robe ColorWash 1200E AT (17ch Mode 1)" entry above is plain data
 * like every other fixture in this file, but that fixture's real DMX
 * behaviour has two quirks the generic per-fixture writer in
 * js/dmx.js's updateDMX() has no way to express from map/photometrics
 * data alone:
 *
 *  - Mode 1's colour control is CMY (channels 9-11), not RGB or a
 *    colour wheel. js/controls.js's primary CMY wheel (shown for this
 *    fixture in place of the main hue/sat wheel) writes cyan/magenta/
 *    yellow directly, but anything else that only ever sets hue/sat/
 *    light (palettes, MIDI mappings, etc.) still needs converting —
 *    the fallback below derives CMY from hue/sat/light whenever no
 *    explicit cyan/magenta/yellow has been set.
 *  - Its shutter/strobe channel doesn't use a plain 0-255 strobe rate:
 *    DMX 0-31 is shutter CLOSED, and this app's strobe control uses 0
 *    to mean OPEN/no-strobe — the two zero points don't match, so the
 *    raw UI value can't be written straight through.
 *
 * This IIFE wraps window.updateDMX to additionally apply this one
 * fixture's real Mode 1 behaviour after the generic writer has run —
 * exactly what js/robe-colorwash-1200e.js used to do as its own
 * separate file; folded in here so this fixture's data and behaviour
 * live together in one place instead of two.
 */
(function installRobeColorWash1200ECompatibility(){

    const NAME = "Robe ColorWash 1200E AT (17ch Mode 1)";

    const map = FixtureLibrary[NAME].map;

    const clamp255 = value => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    const clamp100 = value => Math.max(0, Math.min(100, Number(value) || 0));

    // js/dmx.js's own getFixtureBaseAddress folds the fixture's patch
    // universe into the returned index (State.dmx spans every universe
    // end-to-end) — falling back to address-only is only correct if
    // dmx.js hasn't loaded yet, which shouldn't happen given this whole
    // block is deferred to DOMContentLoaded below, but costs nothing to
    // guard against.
    function getBase(fixture){
        if (typeof window.getFixtureBaseAddress === "function") return window.getFixtureBaseAddress(fixture);
        const n = Number(fixture?.addr ?? fixture?.address ?? fixture?.startAddress ?? fixture?.start ?? fixture?.channel);
        return Number.isFinite(n) && n >= 1 && n <= 512 ? n - 1 : -1;
    }

    function getState(fixture){
        if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
        return window.State?.fixtureStates?.get(fixture.id) || null;
    }

    function write(base, channel, value){
        if (!Number.isInteger(channel)) return;
        const index = base + channel;
        if (index >= 0 && window.State?.dmx && index < window.State.dmx.length) {
            window.State.dmx[index] = clamp255(value);
        }
    }

    function rgbFromHsl(h, s, l){
        h = ((Number(h) || 0) % 360 + 360) % 360 / 60;
        s = clamp100(s) / 100;
        l = clamp100(l) / 100;
        if (s === 0) return [l, l, l];
        const c = (1 - Math.abs(2 * l - 1)) * s;
        const x = c * (1 - Math.abs((h % 2) - 1));
        const m = l - c / 2;
        let r = 0, g = 0, b = 0;
        if (h < 1) { r = c; g = x; }
        else if (h < 2) { r = x; g = c; }
        else if (h < 3) { g = c; b = x; }
        else if (h < 4) { g = x; b = c; }
        else if (h < 5) { r = x; b = c; }
        else { r = c; b = x; }
        return [r + m, g + m, b + m];
    }

    function applyToColorWash(){
        const state = window.State;
        if (!state || !Array.isArray(state.fixtures) || !state.dmx) return;

        for (const fixture of state.fixtures) {
            if (fixture?.name !== NAME) continue;
            const base = getBase(fixture);
            if (base < 0) continue;

            const fixtureState = getState(fixture);
            if (!fixtureState) continue;

            const current = state.current || {};
            const master = clamp100(fixtureState.master ?? current.master ?? 100) / 100;
            const intensity = clamp100(fixtureState.intensity ?? current.intensity ?? 100) / 100;
            const level = state.blackout ? 0 : master * intensity;

            write(base, map.pan, fixtureState.pan ?? current.pan ?? 128);
            write(base, map.panf, fixtureState.panf ?? current.panf ?? 0);
            write(base, map.tilt, fixtureState.tilt ?? current.tilt ?? 128);
            write(base, map.tiltf, fixtureState.tiltf ?? current.tiltf ?? 0);
            write(base, map.speed, fixtureState.speed ?? current.speed ?? 0);
            write(base, map.control, fixtureState.control ?? current.control ?? 0);
            write(base, map.macro, fixtureState.macro ?? current.macro ?? 0);
            write(base, map.macroSpeed, fixtureState.macroSpeed ?? current.macroSpeed ?? 0);

            // Mode 1 colour control is CMY, not RGB and not the colour
            // wheels. The normal colour picker is converted to CMY when
            // explicit CMY values haven't been supplied by the user.
            const cyan = fixtureState.cyan ?? current.cyan;
            const magenta = fixtureState.magenta ?? current.magenta;
            const yellow = fixtureState.yellow ?? current.yellow;

            if (cyan != null || magenta != null || yellow != null) {
                write(base, map.cyan, state.blackout ? 0 : cyan ?? 0);
                write(base, map.magenta, state.blackout ? 0 : magenta ?? 0);
                write(base, map.yellow, state.blackout ? 0 : yellow ?? 0);
            } else {
                const rgb = rgbFromHsl(
                    fixtureState.hue ?? current.hue ?? 0,
                    fixtureState.sat ?? current.sat ?? 100,
                    fixtureState.light ?? current.light ?? 50
                );
                write(base, map.cyan, (1 - rgb[0]) * 255);
                write(base, map.magenta, (1 - rgb[1]) * 255);
                write(base, map.yellow, (1 - rgb[2]) * 255);
            }

            // CTO: 0 = 5600 K / no correction, 255 = 3200 K.
            write(base, map.cto, state.blackout ? 0 : fixtureState.cto ?? current.cto ?? 0);

            // Keep the fixture's physical dimmer open independently of
            // the shutter/strobe control.
            write(base, map.dimmer, state.blackout ? 0 : level * 255);

            // Strobe UI semantics: 0 means OPEN/no strobe, rather than
            // the ROBE shutter-closed DMX range 0-31. Values above zero
            // enter the strobe range 64-95 and therefore do not prevent
            // the dimmer from working.
            const strobe = clamp255(fixtureState.strobe ?? current.strobe ?? 0);
            const strobeDMX = strobe === 0
                ? 63
                : 64 + Math.round((strobe / 255) * 31);
            write(base, map.strobe, state.blackout ? 0 : strobeDMX);

            // Zoom is a single 8-bit proportional channel in Mode 1.
            write(base, map.zoom, fixtureState.zoom ?? current.zoom ?? 0);

            // Fresnel opening: 85 DMX is the LightMax/high-intensity spot point.
            write(base, map.fresnel, fixtureState.fresnel ?? current.fresnel ?? 0);

            // Effect speed is channel 13 in Mode 1.
            write(base, map.effectSpeed, fixtureState.effectSpeed ?? current.effectSpeed ?? 0);
        }
    }

    function install(){
        if (window.__robeColorWash1200ECompat) return;
        window.__robeColorWash1200ECompat = true;

        const originalUpdateDMX = window.updateDMX;
        if (typeof originalUpdateDMX === "function") {
            window.updateDMX = function robeColorWashCompatibleUpdateDMX(){
                originalUpdateDMX.apply(this, arguments);
                applyToColorWash();
            };
        }

        window.renderLibrary?.();
        window.renderFixtures?.();
        window.updateControlVisibility?.();
    }

    // Deferred to DOMContentLoaded rather than installed immediately —
    // this file loads before js/dmx.js in index.html, so window.updateDMX
    // doesn't exist yet at the point this script itself runs. Every
    // <script> tag between the two is a plain blocking tag (no async/
    // defer), so by the time DOMContentLoaded fires, js/dmx.js (and
    // anything else that might also wrap window.updateDMX) has already
    // run — this wraps whichever version of updateDMX is current at that
    // point, same as the standalone file this replaced did with its own
    // setInterval-based retry loop, just without needing to poll.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
        install();
    }

})();


/*
 * ============================================================
 * HIGH END SYSTEMS CYBERLIGHT COMPATIBILITY
 * ============================================================
 *
 * The "High End Systems Cyberlight (20ch Mode 1)" entry's map is a
 * faithful transcription of Table A-2 in the official manual, but two
 * channels need a runtime translation the generic per-fixture writer
 * in js/dmx.js can't express from map data alone — the same category
 * of quirk the ROBE ColorWash compat hook above exists for.
 *
 * Channel 17 ("Shutter") is a real mechanical shutter, not a plain
 * strobe-rate channel: per Table A-2, DMX 0 is CLOSED (no light passes
 * at all, regardless of the separate Dim channel), "Full" (255) is
 * OPEN, and the strobe-speed positions live in between. This app's
 * strobe control uses 0 to mean OPEN/no-strobe (every other fixture in
 * this library follows that convention) — written straight through,
 * an untouched CyberLight would sit fully shuttered CLOSED forever,
 * i.e. it would never appear to output any light no matter what the
 * dimmer/colour/pan-tilt controls were set to. This hook remaps the
 * UI's 0-255 strobe value into the real channel's actual ranges after
 * the generic writer has run: 0 -> Full/Open, 1-255 -> the strobe-speed
 * band.
 *
 * Channels 6-8 (Cyan/Magenta/Yellow) also need inverting — see the
 * long comment at the write() calls for them below. Table A-2 never
 * states a direction for these three lines the way it does for the
 * shutter, so the polarity had to be found empirically: tested against
 * a real DMX receiver (Capture) with an actual Cyberlight patched,
 * picking red on this app's CMY wheel came out as cyan, red's exact
 * complement — meaning this fixture's real channels are the opposite
 * polarity from every other CMY fixture in this library.
 */
(function installCyberlightCompatibility(){

    const NAME = "High End Systems Cyberlight (20ch Mode 1)";

    const map = FixtureLibrary[NAME].map;

    const clamp255 = value => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));

    function getBase(fixture){
        if (typeof window.getFixtureBaseAddress === "function") return window.getFixtureBaseAddress(fixture);
        const n = Number(fixture?.addr ?? fixture?.address ?? fixture?.startAddress ?? fixture?.start ?? fixture?.channel);
        return Number.isFinite(n) && n >= 1 && n <= 512 ? n - 1 : -1;
    }

    function getState(fixture){
        if (typeof window.ensureFixtureState === "function") return window.ensureFixtureState(fixture.id);
        return window.State?.fixtureStates?.get(fixture.id) || null;
    }

    function write(base, channel, value){
        if (!Number.isInteger(channel)) return;
        const index = base + channel;
        if (index >= 0 && window.State?.dmx && index < window.State.dmx.length) {
            window.State.dmx[index] = clamp255(value);
        }
    }

    function applyToCyberlight(){
        const state = window.State;
        if (!state || !Array.isArray(state.fixtures) || !state.dmx) return;

        for (const fixture of state.fixtures) {
            if (fixture?.name !== NAME) continue;
            const base = getBase(fixture);
            if (base < 0) continue;

            const fixtureState = getState(fixture);
            if (!fixtureState) continue;

            const current = state.current || {};

            // Strobe UI semantics: 0 means OPEN/no-strobe, rather than
            // the real Channel 17 shutter-closed DMX value of 0. Values
            // above zero enter the strobe-speed band (Table A-2's eight
            // "Strobe speed" positions, roughly DMX 50-205) so they
            // still strobe rather than closing the shutter or doing
            // nothing.
            const strobe = clamp255(fixtureState.strobe ?? current.strobe ?? 0);
            const strobeDMX = strobe === 0
                ? 255
                : 50 + Math.round((strobe / 255) * 155);
            write(base, map.strobe, state.blackout ? 0 : strobeDMX);

            // CMY polarity: every other CMY fixture in this library (and
            // this app's own CMY colour wheel — js/controls.js's
            // buildPrimaryCMYWheel) assumes DMX 0 = filter fully OPEN,
            // 255 = fully engaged — that's the convention the generic
            // writer in js/dmx.js already applied by the time this hook
            // runs (fixtureState.cyan/magenta/yellow written straight
            // through as DMX bytes). Tested against a real DMX receiver
            // (Capture, a third-party visualizer) with an actual
            // Cyberlight patched, this fixture's real hardware turned
            // out to use the OPPOSITE polarity: picking red on the CMY
            // wheel (which sends low cyan / high magenta+yellow under
            // the app's assumed convention) came out as cyan — red's
            // exact complement — meaning DMX 0 is actually FULLY
            // ENGAGED and 255 is OPEN on this real fixture's channels 6-
            // 8. The manual's Table A-2 only names which channel is
            // which colour ("Channel 6 Cyan", etc.) without ever stating
            // a direction for either, so this couldn't have been caught
            // from the document alone — inverting here, after the
            // generic writer, corrects it for this fixture only, without
            // assuming (wrongly, per this same test) that every other
            // CMY fixture shares the same polarity.
            if (typeof map.cyan === "number") write(base, map.cyan, state.blackout ? 0 : 255 - clamp255(fixtureState.cyan ?? current.cyan ?? 0));
            if (typeof map.magenta === "number") write(base, map.magenta, state.blackout ? 0 : 255 - clamp255(fixtureState.magenta ?? current.magenta ?? 0));
            if (typeof map.yellow === "number") write(base, map.yellow, state.blackout ? 0 : 255 - clamp255(fixtureState.yellow ?? current.yellow ?? 0));
        }
    }

    function install(){
        if (window.__cyberlightCompat) return;
        window.__cyberlightCompat = true;

        const originalUpdateDMX = window.updateDMX;
        if (typeof originalUpdateDMX === "function") {
            window.updateDMX = function cyberlightCompatibleUpdateDMX(){
                originalUpdateDMX.apply(this, arguments);
                applyToCyberlight();
            };
        }

        window.renderLibrary?.();
        window.renderFixtures?.();
        window.updateControlVisibility?.();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
        install();
    }

})();

