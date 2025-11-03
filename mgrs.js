(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
        typeof define === 'function' && define.amd ? define(['exports'], factory) :
            (factory((global.mgrs = global.mgrs || {})));
} (this, (function (exports) {
    'use strict';

    var NUM_100K_SETS = 6;

    var SET_ORIGIN_COLUMN_LETTERS = 'AJSAJS';

    var SET_ORIGIN_ROW_LETTERS = 'AFAFAF';

    var A = 65;
    var I = 73;
    var O = 79;
    var V = 86;
    var Z = 90;
    var mgrs = {
        forward: forward,
        inverse: inverse,
        toPoint: toPoint
    };

    function forward(ll, accuracy) {
        accuracy = accuracy || 5;
        return encode(LLtoUTM({
            lat: ll[1],
            lon: ll[0]
        }), accuracy);
    }

    function inverse(mgrs) {
        var bbox = UTMtoLL(decode(mgrs.toUpperCase()));
        if (bbox.lat && bbox.lon) {
            return [bbox.lon, bbox.lat, bbox.lon, bbox.lat];
        }
        return [bbox.left, bbox.bottom, bbox.right, bbox.top];
    }

    function toPoint(mgrs) {
        var bbox = UTMtoLL(decode(mgrs.toUpperCase()));
        if (bbox.lat && bbox.lon) {
            return [bbox.lon, bbox.lat];
        }
        return [(bbox.left + bbox.right) / 2, (bbox.top + bbox.bottom) / 2];
    }

    function radToDeg(rad) {
        return (180.0 * (rad / Math.PI));
    }

    function degToRad(deg) {
        return (deg * (Math.PI / 180.0));
    }

    function LLtoUTM(ll) {
        var Lat = ll.lat;
        var Long = ll.lon;
        var a = 6378137.0;
        var eccSquared = 0.00669438;
        var k0 = 0.9996;
        var LongOrigin;
        var eccPrimeSquared;
        var N, T, C, A, M;
        var LatRad = degToRad(Lat);
        var LongRad = degToRad(Long);
        var LongOriginRad;
        var ZoneNumber;

        ZoneNumber = Math.floor((Long + 180) / 6) + 1;

        if (Long === 180) {
            ZoneNumber = 60;
        }

        if (Lat >= 56.0 && Lat < 64.0 && Long >= 3.0 && Long < 12.0) {
            ZoneNumber = 32
        }

        if (Lat >= 72.0 && Lat < 84.0) {
            if (Long >= 0.0 && Long < 9.0) {
                ZoneNumber = 31;
            }
            else if (Long >= 9.0 && Long < 21.0) {
                ZoneNumber = 33;
            }
            else if (Long >= 21.0 && Long < 33.0) {
                ZoneNumber = 35;
            }
            else if (Long >= 33.0 && Long < 42.0) {
                ZoneNumber = 37;
            }
        }

        LongOrigin = (ZoneNumber - 1) * 6 - 180 + 3;

        LongOriginRad = degToRad(LongOrigin);

        eccPrimeSquared = (eccSquared) / (1 - eccSquared);

        N = a / Math.sqrt(1 - eccSquared * Math.sin(LatRad) * Math.sin(LatRad));
        T = Math.tan(LatRad) * Math.tan(LatRad);
        C = eccPrimeSquared * Math.cos(LatRad) * Math.cos(LatRad);
        A = Math.cos(LatRad) * (LongRad - LongOriginRad);

        M = a * ((1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256) * LatRad - (3 * eccSquared / 8 + 3 * eccSquared * eccSquared / 32 + 45 * eccSquared * eccSquared * eccSquared / 1024) * Math.sin(2 * LatRad) + (15 * eccSquared * eccSquared / 256 + 45 * eccSquared * eccSquared * eccSquared / 1024) * Math.sin(4 * LatRad) - (35 * eccSquared * eccSquared * eccSquared / 3072) * Math.sin(6 * LatRad));

        var UTMEasting = (k0 * N * (A + (1 - T + C) * A * A * A / 6.0 + (5 - 18 * T + T * T + 72 * C - 58 * eccPrimeSquared) * A * A * A * A * A / 120.0) + 500000.0);

        var UTMNorthing = (k0 * (M + N * Math.tan(LatRad) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A * A * A * A / 24.0 + (61 - 58 * T + T * T + 600 * C - 330 * eccPrimeSquared) * A * A * A * A * A * A / 720.0)));
        if (Lat < 0.0) {
            UTMNorthing += 10000000.0;
        }

        return {
            northing: Math.trunc(UTMNorthing),
            easting: Math.trunc(UTMEasting),
            zoneNumber: ZoneNumber,
            zoneLetter: getLetterDesignator(Lat)
        };
    }

    function UTMtoLL(utm) {
        var UTMNorthing = utm.northing;
        var UTMEasting = utm.easting;
        var zoneLetter = utm.zoneLetter;
        var zoneNumber = utm.zoneNumber;

        if (zoneNumber < 0 || zoneNumber > 60) {
            return null;
        }

        var k0 = 0.9996;
        var a = 6378137.0;
        var eccSquared = 0.00669438;
        var eccPrimeSquared;
        var e1 = (1 - Math.sqrt(1 - eccSquared)) / (1 + Math.sqrt(1 - eccSquared));
        var N1, T1, C1, R1, D, M;
        var LongOrigin;
        var mu, phi1Rad;

        var x = UTMEasting - 500000.0;
        var y = UTMNorthing;

        if (zoneLetter < 'N') {
            y -= 10000000.0;
        }

        LongOrigin = (zoneNumber - 1) * 6 - 180 + 3;

        eccPrimeSquared = (eccSquared) / (1 - eccSquared);

        M = y / k0;
        mu = M / (a * (1 - eccSquared / 4 - 3 * eccSquared * eccSquared / 64 - 5 * eccSquared * eccSquared * eccSquared / 256));

        phi1Rad = mu + (3 * e1 / 2 - 27 * e1 * e1 * e1 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 * e1 * e1 * e1 / 32) * Math.sin(4 * mu) + (151 * e1 * e1 * e1 / 96) * Math.sin(6 * mu);

        N1 = a / Math.sqrt(1 - eccSquared * Math.sin(phi1Rad) * Math.sin(phi1Rad));
        T1 = Math.tan(phi1Rad) * Math.tan(phi1Rad);
        C1 = eccPrimeSquared * Math.cos(phi1Rad) * Math.cos(phi1Rad);
        R1 = a * (1 - eccSquared) / Math.pow(1 - eccSquared * Math.sin(phi1Rad) * Math.sin(phi1Rad), 1.5);
        D = x / (N1 * k0);

        var lat = phi1Rad - (N1 * Math.tan(phi1Rad) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * eccPrimeSquared) * D * D * D * D / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * eccPrimeSquared - 3 * C1 * C1) * D * D * D * D * D * D / 720);
        lat = radToDeg(lat);

        var lon = (D - (1 + 2 * T1 + C1) * D * D * D / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * eccPrimeSquared + 24 * T1 * T1) * D * D * D * D * D / 120) / Math.cos(phi1Rad);
        lon = LongOrigin + radToDeg(lon);

        var result;
        if (utm.accuracy) {
            var topRight = UTMtoLL({
                northing: utm.northing + utm.accuracy,
                easting: utm.easting + utm.accuracy,
                zoneLetter: utm.zoneLetter,
                zoneNumber: utm.zoneNumber
            });
            result = {
                top: topRight.lat,
                right: topRight.lon,
                bottom: lat,
                left: lon
            };
        }
        else {
            result = {
                lat: lat,
                lon: lon
            };

        }
        return result;
    }

    function getLetterDesignator(lat) {
        var LetterDesignator = 'Z';

        if ((84 >= lat) && (lat >= 72)) {
            LetterDesignator = 'X';
        }
        else if ((72 > lat) && (lat >= 64)) {
            LetterDesignator = 'W';
        }
        else if ((64 > lat) && (lat >= 56)) {
            LetterDesignator = 'V';
        }
        else if ((56 > lat) && (lat >= 48)) {
            LetterDesignator = 'U';
        }
        else if ((48 > lat) && (lat >= 40)) {
            LetterDesignator = 'T';
        }
        else if ((40 > lat) && (lat >= 32)) {
            LetterDesignator = 'S';
        }
        else if ((32 > lat) && (lat >= 24)) {
            LetterDesignator = 'R';
        }
        else if ((24 > lat) && (lat >= 16)) {
            LetterDesignator = 'Q';
        }
        else if ((16 > lat) && (lat >= 8)) {
            LetterDesignator = 'P';
        }
        else if ((8 > lat) && (lat >= 0)) {
            LetterDesignator = 'N';
        }
        else if ((0 > lat) && (lat >= -8)) {
            LetterDesignator = 'M';
        }
        else if ((-8 > lat) && (lat >= -16)) {
            LetterDesignator = 'L';
        }
        else if ((-16 > lat) && (lat >= -24)) {
            LetterDesignator = 'K';
        }
        else if ((-24 > lat) && (lat >= -32)) {
            LetterDesignator = 'J';
        }
        else if ((-32 > lat) && (lat >= -40)) {
            LetterDesignator = 'H';
        }
        else if ((-40 > lat) && (lat >= -48)) {
            LetterDesignator = 'G';
        }
        else if ((-48 > lat) && (lat >= -56)) {
            LetterDesignator = 'F';
        }
        else if ((-56 > lat) && (lat >= -64)) {
            LetterDesignator = 'E';
        }
        else if ((-64 > lat) && (lat >= -72)) {
            LetterDesignator = 'D';
        }
        else if ((-72 > lat) && (lat >= -80)) {
            LetterDesignator = 'C';
        }
        return LetterDesignator;
    }

    function encode(utm, accuracy) {
        var seasting = "00000" + utm.easting,
            snorthing = "00000" + utm.northing;

        return utm.zoneNumber + utm.zoneLetter + get100kID(utm.easting, utm.northing, utm.zoneNumber) + seasting.substr(seasting.length - 5, accuracy) + snorthing.substr(snorthing.length - 5, accuracy);

    }

    function get100kID(easting, northing, zoneNumber) {
        var setParm = get100kSetForZone(zoneNumber);
        var setColumn = Math.floor(easting / 100000);
        var setRow = Math.floor(northing / 100000) % 20;
        return getLetter100kID(setColumn, setRow, setParm);
    }

    function get100kSetForZone(i) {
        var setParm = i % NUM_100K_SETS;
        if (setParm === 0) {
            setParm = NUM_100K_SETS;
        }
        return setParm;
    }

    function getLetter100kID(column, row, parm) {
        var index = parm - 1;
        var colOrigin = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(index);
        var rowOrigin = SET_ORIGIN_ROW_LETTERS.charCodeAt(index);

        var colInt = colOrigin + column - 1;
        var rowInt = rowOrigin + row;
        var rollover = false;

        if (colInt > Z) {
            colInt = colInt - Z + A - 1;
            rollover = true;
        }

        if (colInt === I || (colOrigin < I && colInt > I) || ((colInt > I || colOrigin < I) && rollover)) {
            colInt++;
        }
        if (colInt === O || (colOrigin < O && colInt > O) || ((colInt > O || colOrigin < O) && rollover)) {
            colInt++;

            if (colInt === I) {
                colInt++;
            }
        }

        if (colInt > Z) {
            colInt = colInt - Z + A - 1;
        }
        if (rowInt > V) {
            rowInt = rowInt - V + A - 1;
            rollover = true;
        }
        else {
            rollover = false;
        }

        if (((rowInt === I) || ((rowOrigin < I) && (rowInt > I))) || (((rowInt > I) || (rowOrigin < I)) && rollover)) {
            rowInt++;
        }

        if (((rowInt === O) || ((rowOrigin < O) && (rowInt > O))) || (((rowInt > O) || (rowOrigin < O)) && rollover)) {
            rowInt++;
            if (rowInt === I) {
                rowInt++;
            }
        }

        if (rowInt > V) {
            rowInt = rowInt - V + A - 1;
        }

        var twoLetter = String.fromCharCode(colInt) + String.fromCharCode(rowInt);
        return twoLetter;
    }

    function decode(mgrsString) {
        if (mgrsString && mgrsString === 0) {
            throw ("MGRSPoint converting from nothing");
        }

        var length = mgrsString.length;

        var hunK = null;
        var sb = "";
        var testChar;
        var i = 0;

        while (!(/[A-Z]/).test(testChar = mgrsString.charAt(i))) {
            if (i >= 2) {
                throw ("MGRSPoint bad conversion from: " + mgrsString);
            }
            sb += testChar;
            i++;
        }

        var zoneNumber = parseInt(sb, 10);

        if (i === 0 || i + 3 > length) {
            throw ("MGRSPoint bad conversion from: " + mgrsString);
        }

        var zoneLetter = mgrsString.charAt(i++);

        if (zoneLetter <= 'A' || zoneLetter === 'B' || zoneLetter === 'Y' || zoneLetter >= 'Z' || zoneLetter === 'I' || zoneLetter === 'O') {
            throw ("MGRSPoint zone letter " + zoneLetter + " not handled: " + mgrsString);
        }

        hunK = mgrsString.substring(i, i += 2);

        var set = get100kSetForZone(zoneNumber);

        var east100k = getEastingFromChar(hunK.charAt(0), set);
        var north100k = getNorthingFromChar(hunK.charAt(1), set);

        while (north100k < getMinNorthing(zoneLetter)) {
            north100k += 2000000;
        }

        var remainder = length - i;

        if (remainder % 2 !== 0) {
            throw ("MGRSPoint has to be an even number of \ndigits after the zone letter and two 100km letters - front half \nfor easting meters, second half for northing\n meters" + mgrsString);
        }

        var sep = remainder / 2;

        var sepEasting = 0.0;
        var sepNorthing = 0.0;
        var accuracyBonus, sepEastingString, sepNorthingString, easting, northing;

        if (sep > 0) {
            accuracyBonus = 100000.0 / Math.pow(10, sep);
            sepEastingString = mgrsString.substring(i, i + sep);
            sepEasting = parseFloat(sepEastingString) * accuracyBonus;
            sepNorthingString = mgrsString.substring(i + sep);
            sepNorthing = parseFloat(sepNorthingString) * accuracyBonus;
        }

        easting = sepEasting + east100k;
        northing = sepNorthing + north100k;

        return {
            easting: easting,
            northing: northing,
            zoneLetter: zoneLetter,
            zoneNumber: zoneNumber,
            accuracy: accuracyBonus
        };

    }

    function getEastingFromChar(e, set) {
        var curCol = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(set - 1);
        var eastingValue = 100000.0;
        var rewindMarker = false;

        while (curCol !== e.charCodeAt(0)) {
            curCol++;
            if (curCol === I) {
                curCol++;
            }
            if (curCol === O) {
                curCol++;
            }
            if (curCol > Z) {
                if (rewindMarker) {
                    throw ("Bad character: " + e);

                }
                curCol = A;
                rewindMarker = true;
            }
            eastingValue += 100000.0;
        }
        return eastingValue;
    }

    function getNorthingFromChar(n, set) {
        var curRow = SET_ORIGIN_ROW_LETTERS.charCodeAt(set - 1);
        var northingValue = 0.0;
        var rewindMarker = false;

        while (curRow !== n.charCodeAt(0)) {
            curRow++;
            if (curRow === I) {
                curRow++;
            }
            if (curRow === O) {
                curRow++;
            }
            if (curRow > V) {
                if (rewindMarker) {
                    throw ("Bad character: " + n);

                }
                curRow = A;
                rewindMarker = true;
            }
            northingValue += 100000.0;
        }
        return northingValue;
    }

    function getMinNorthing(zoneLetter) {
        var northing;
        switch (zoneLetter) {
            case 'C':
                northing = 1100000.0;
                break;
            case 'D':
                northing = 2000000.0;
                break;
            case 'E':
                northing = 2800000.0;
                break;
            case 'F':
                northing = 3700000.0;
                break;
            case 'G':
                northing = 4600000.0;
                break;
            case 'H':
                northing = 5500000.0;
                break;
            case 'J':
                northing = 6400000.0;
                break;
            case 'K':
                northing = 7300000.0;
                break;
            case 'L':
                northing = 8200000.0;
                break;
            case 'M':
                northing = 9100000.0;
                break;
            case 'N':
                northing = 0.0;
                break;
            case 'P':
                northing = 800000.0;
                break;
            case 'Q':
                northing = 1700000.0;
                break;
            case 'R':
                northing = 2600000.0;
                break;
            case 'S':
                northing = 3500000.0;
                break;
            case 'T':
                northing = 4400000.0;
                break;
            case 'U':
                northing = 5300000.0;
                break;
            case 'V':
                northing = 6200000.0;
                break;
            case 'W':
                northing = 7000000.0;
                break;
            case 'X':
                northing = 7900000.0;
                break;
            default:
                northing = -1.0;
        }
        if (northing >= 0.0) {
            return northing;
        }
        else {
            throw ("Invalid zone letter: " + zoneLetter);
        }
    }

    exports['default'] = mgrs;
    exports.forward = forward;
    exports.inverse = inverse;
    exports.toPoint = toPoint;

    Object.defineProperty(exports, '__esModule', { value: true });
})));