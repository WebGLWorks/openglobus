/**
 * @module og/camera/PlanetCamera
 */

'use strict';

import * as math from '../math.js';
import * as mercator from '../mercator.js';
import { Camera } from './Camera.js';
import { Vec3 } from '../math/Vec3.js';
import { Key } from '../Lock.js';
import { LonLat } from '../LonLat.js';
import { Mat4 } from '../math/Mat4.js';
import { Ray } from '../math/Ray.js';

/**
 * Planet camera.
 * @class
 * @extends {og.Camera}
 * @param {og.RenderNode} planet - Planet render node.
 * @param {Object} [options] - Planet camera options:
 * @param {Object} [options.name] - Camera name.
 * @param {number} [options.viewAngle] - Camera angle of view. Default is 35.0
 * @param {number} [options.near] - Camera near plane distance. Default is 1.0
 * @param {number} [options.far] - Camera far plane distance. Deafult is og.math.MAX
 * @param {number} [options.minAltitude] - Minimal altitude for the camera. Deafult is 50
 * @param {og.Vec3} [options.eye] - Camera eye position. Default (0,0,0)
 * @param {og.Vec3} [options.look] - Camera look position. Default (0,0,0)
 * @param {og.Vec3} [options.up] - Camera eye position. Default (0,1,0)
 */
class PlanetCamera extends Camera {
    constructor(planet, options) {
        super(planet.renderer, options);
        /**
         * Assigned camera's planet.
         * @public
         * @type {og.scene.Planet}
         */
        this.planet = planet;

        /**
         * Minimal alltitude that camera can reach over the terrain.
         * @public
         * @type {number}
         */
        this.minAltitude = options.minAltitude || 50;

        /**
         * Current geographical degree position.
         * @protected
         * @type {og.LonLat}
         */
        this._lonLat = this.planet.ellipsoid.cartesianToLonLat(this.eye);

        /**
         * Current geographical mercator position.
         * @protected
         * @type {og.LonLat}
         */
        this._lonLatMerc = this._lonLat.forwardMercator();

        /**
         * Current altitude.
         * @protected
         * @type {number}
         */
        this._terrainAltitude = this._lonLat.height;

        /**
         * Cartesian coordinates on the terrain.
         * @protected
         * @type {og.Vec3}
         */
        this._terrainPoint = new Vec3();

        /**
         * Quad node that camera flies over.
         * @protected
         * @type {og.quadTree.Node}
         */
        this._insideSegment = null;

        this.slope = 0;

        /**
         * Coordinates that depends on what segment class we are fling over.
         * It can be WGS84 or Mercator coordinates. Gets in og.quadTree.Node
         * @protected
         * @type {og.LonLat}
         */
        this._insideSegmentPosition = new LonLat();

        this._keyLock = new Key();

        //Camera's flying frames
        this._framesArr = [];
        this._framesCounter = 0;
        this._numFrames = 50;
        this._completeCallback = null;
        this._flying = false;
    }

    /**
     * Clone planet camera instance to another one.
     * @public
     * @virtual
     * @returns {og.PlanetCamera}
     */
    clone() {
        var newcam = new PlanetCamera();
        newcam.eye.copy(cam.eye);
        newcam._u.copy(cam._u);
        newcam._v.copy(cam._v);
        newcam._n.copy(cam._n);
        newcam.renderer = cam.renderer;
        newcam._projectionMatrix.copy(cam._projectionMatrix);
        newcam._viewMatrix.copy(cam._viewMatrix);
        newcam._projectionViewMatrix.copy(cam._projectionViewMatrix);
        newcam._inverseProjectionViewMatrix.copy(cam._inverseProjectionViewMatrix);
        newcam.frustum.setFrustum(newcam._projectionViewMatrix);
        newcam.planet = cam.planet;
        newcam._lonLat = cam._lonLat.clone();
        return newcam;
    }

    /**
     * Updates camera view space.
     * @public
     * @virtual
     */
    update() {

        this._setViewMatrix();

        this._projectionViewMatrix = this._projectionMatrix.mul(this._viewMatrix);
        this.frustum.setFrustum(this._projectionViewMatrix);

        this._inverseProjectionViewMatrix = this._projectionMatrixPrecise.mul(this._viewMatrix).inverseTo();

        //this._normalMatrix = this._viewMatrix.toInverseMatrix3().transposeTo();
        this._normalMatrix = this._viewMatrix.toMatrix3();

        this.updateGeodeticPosition();

        this.eyeNorm = this.eye.normal();

        this.slope = this._n.dot(this.eyeNorm);

        this.events.dispatch(this.events.viewchange, this);
    }

    updateGeodeticPosition() {
        this._lonLat = this.planet.ellipsoid.cartesianToLonLat(this.eye);
        if (Math.abs(this._lonLat.lat) <= mercator.MAX_LAT) {
            this._lonLatMerc = this._lonLat.forwardMercator();
        }
    }

    /**
     * Sets altitude over the terrain.
     * @public
     * @param {number} alt - Altitude over the terrain.
     */
    setAltitude(alt) {
        var n = this.eye.normal();
        var t = this._terrainPoint;
        this.eye.x = n.x * alt + t.x;
        this.eye.y = n.y * alt + t.y;
        this.eye.z = n.z * alt + t.z;
        this._terrainAltitude = alt;
        this.update();
    }

    /**
     * Gets altitude over the terrain.
     * @public
     */
    getAltitude() {
        return this._terrainAltitude;
    }

    /**
     * Places camera to view to the geographical point.
     * @public
     * @param {og.LonLat} lonlat - New camera and camera view position.
     * @param {og.LonLat} [lookLonLat] - Look up coordinates.
     * @param {og.Vec3} [up] - Camera UP vector. Default (0,1,0)
     */
    setLonLat(lonlat, lookLonLat, up) {
        this.stopFlying();
        this._lonLat.set(lonlat.lon, lonlat.lat, lonlat.height || this._lonLat.height);
        var el = this.planet.ellipsoid;
        var newEye = el.lonLatToCartesian(this._lonLat);
        var newLook = lookLonLat ? el.lonLatToCartesian(lookLonLat) : Vec3.ZERO;
        this.set(newEye, newLook, up || Vec3.UP);
        this.refresh();
    }

    /**
     * Returns camera geographical position.
     * @public
     * @returns {og.LonLat}
     */
    getLonLat() {
        return this._lonLat;
    }

    /**
     * Returns camera height.
     * @public
     * @returns {number}
     */
    getHeight() {
        return this._lonLat.height;
    }

    /**
     * Gets position by viewable extent.
     * @public
     * @param {og.Extent} extent - Viewable extent.
     * @param {Number} height - Camera height
     * @returns {og.Vec3}
     */
    getExtentPosition(extent, height) {

        var north = extent.getNorth();
        var south = extent.getSouth();
        var east = extent.getEast();
        var west = extent.getWest();

        if (west > east) {
            east += 360;
        }

        var e = this.planet.ellipsoid;

        var cart = new LonLat(east, north);
        var northEast = e.lonLatToCartesian(cart);
        cart.lat = south;
        var southEast = e.lonLatToCartesian(cart);
        cart.lon = west;
        var southWest = e.lonLatToCartesian(cart);
        cart.lat = north;
        var northWest = e.lonLatToCartesian(cart);

        var center = Vec3.sub(northEast, southWest).scale(0.5).addA(southWest);

        var mag = center.length();
        if (mag < 0.000001) {
            cart.lon = (east + west) * 0.5;
            cart.lat = (north + south) * 0.5;
            center = e.lonLatToCartesian(cart);
        }

        northWest.subA(center);
        southEast.subA(center);
        northEast.subA(center);
        southWest.subA(center);

        var direction = center.normal();//ellipsoid.getSurfaceNormal(center).negate().normalize();
        var right = direction.cross(Vec3.UP).normalize();
        var up = right.cross(direction).normalize();

        var _h = Math.max(
            Math.abs(up.dot(northWest)),
            Math.abs(up.dot(southEast)),
            Math.abs(up.dot(northEast)),
            Math.abs(up.dot(southWest))
        );

        var _w = Math.max(
            Math.abs(right.dot(northWest)),
            Math.abs(right.dot(southEast)),
            Math.abs(right.dot(northEast)),
            Math.abs(right.dot(southWest))
        );

        var tanPhi = Math.tan(this._viewAngle * math.RADIANS * 0.5);
        var tanTheta = this._aspect * tanPhi;
        var d = Math.max(_w / tanTheta, _h / tanPhi);

        center.normalize();
        center.scale(mag + d + (height || 0));

        return center;
    }

    /**
     * View current extent.
     * @public
     * @param {og.Extent} extent - Current extent.
     */
    viewExtent(extent, height) {
        this.stopFlying();
        this.set(this.getExtentPosition(extent, height), Vec3.ZERO, Vec3.UP);
        this.refresh();
    }

    /**
     * Flies to the current extent.
     * @public
     * @param {og.Extent} extent - Current extent.
     * @param {og.Vec3} [up] - Camera UP in the end of flying. Default - (0,1,0)
     * @param {cameraCallback} [completeCallback] - Callback that calls after flying when flying is finished.
     * @param {cameraCallback} [startCallback] - Callback that calls befor the flying begins.
     */
    flyExtent(extent, height, up, completeCallback, startCallback) {
        this.flyCartesian(this.getExtentPosition(extent, height), Vec3.ZERO,
            up, completeCallback, startCallback);
    }

    /**
     * Flies to the cartesian coordinates.
     * @public
     * @param {og.Vec3} cartesian - Finish cartesian coordinates.
     * @param {og.Vec3} [look] - Camera LOOK in the end of flying. Default - (0,0,0)
     * @param {og.Vec3} [up] - Camera UP vector in the end of flying. Default - (0,1,0)
     * @param {cameraCallback} [completeCallback] - Callback that calls after flying when flying is finished.
     * @param {cameraCallback} [startCallback] - Callback that calls befor the flying begins.
     */
    flyCartesian(cartesian, look, up, completeCallback, startCallback) {

        //???????
        //if (this.eye.distance(cartesian) < 23000) {
        //    return;
        //}

        this.stopFlying();

        this._completeCallback = completeCallback;

        if (startCallback) {
            startCallback.call(this);
        }

        look = look || Vec3.ZERO;
        if (look instanceof LonLat) {
            look = this.planet.ellipsoid.lonLatToCartesian(look);
        }

        var ground_a = this.planet.ellipsoid.lonLatToCartesian(new LonLat(this._lonLat.lon, this._lonLat.lat));
        var v_a = this._v,
            n_a = this._n;

        var lonlat_b = this.planet.ellipsoid.cartesianToLonLat(cartesian);
        var up_b = up || Vec3.UP;
        var ground_b = this.planet.ellipsoid.lonLatToCartesian(new LonLat(lonlat_b.lon, lonlat_b.lat, 0));
        var eye_b = cartesian;
        var n_b = Vec3.sub(eye_b, look);
        var u_b = up_b.cross(n_b);
        n_b.normalize();
        u_b.normalize();
        var v_b = n_b.cross(u_b);

        var an = ground_a.normal();
        var bn = ground_b.normal();
        var anbn = 1.0 - an.dot(bn);
        var hM_a = math.SQRT_HALF * Math.sqrt((anbn) > 0.0 ? anbn : 0.0);

        var maxHeight = 6639613;
        var currMaxHeight = Math.max(this._lonLat.height, lonlat_b.height);
        if (currMaxHeight > maxHeight) {
            maxHeight = currMaxHeight;
        }
        var max_h = currMaxHeight + 2.5 * hM_a * (maxHeight - currMaxHeight);
        var zero = Vec3.ZERO;

        //camera path and orientations calculation
        for (var i = 0; i <= this._numFrames; i++) {
            var d = 1 - i / this._numFrames;
            d = d * d * (3 - 2 * d);
            d *= d;

            //Error here
            var g_i = ground_a.smerp(ground_b, d).normalize();
            var ground_i = this.planet.getRayIntersectionEllipsoid(new Ray(zero, g_i));
            var t = 1 - d;
            var height_i = this._lonLat.height * d * d * d + max_h * 3 * d * d * t + max_h * 3 * d * t * t + lonlat_b.height * t * t * t;

            var eye_i = ground_i.addA(g_i.scale(height_i));
            var up_i = v_a.smerp(v_b, d);
            var look_i = Vec3.add(eye_i, n_a.smerp(n_b, d).negateTo());

            var n = new Vec3(eye_i.x - look_i.x, eye_i.y - look_i.y, eye_i.z - look_i.z);
            var u = up_i.cross(n);
            n.normalize();
            u.normalize();

            var v = n.cross(u);
            this._framesArr[i] = {
                "eye": eye_i,
                "n": n,
                "u": u,
                "v": v
            };
        }

        this._framesCounter = this._numFrames;
        this._flying = true;
    }

    /**
     * Flies to the geo coordiantes.
     * @public
     * @param {og.LonLat} lonlat - Finish coordinates.
     * @param {og.Vec3} [look] - Camera LOOK in the end of flying. Default - (0,0,0)
     * @param {og.Vec3} [up] - Camera UP vector in the end of flying. Default - (0,1,0)
     * @param {cameraCallback} [completeCallback] - Callback that calls after flying when flying is finished.
     * @param {cameraCallback} [startCallback] - Callback that calls befor the flying begins.
     */
    flyLonLat(lonlat, look, up, completeCallback, startCallback) {
        var _lonlat = new LonLat(lonlat.lon, lonlat.lat, lonlat.height || this._lonLat.height);
        this.flyCartesian(this.planet.ellipsoid.lonLatToCartesian(_lonlat), look, up, completeCallback, startCallback);
    }

    /**
     * Breaks the flight.
     * @public
     */
    stopFlying() {

        this.planet.layerLock.free(this._keyLock);
        this.planet.terrainLock.free(this._keyLock);
        this.planet._normalMapCreator.free(this._keyLock);

        this._flying = false;
        this._framesArr.length = 0;
        this._framesArr = [];
        this._framesCounter = -1;
    }

    /**
     * Returns camera is flying.
     * @public
     * @returns {boolean}
     */
    isFlying() {
        return this._flying;
    }

    /**
     * Rotates around planet to the left.
     * @public
     * @param {number} angle - Rotation angle.
     * @param {boolean} [spin] - If its true rotates around globe spin.
     */
    rotateLeft(angle, spin) {
        this.rotateHorizontal(angle * math.RADIANS, spin ^ true, Vec3.ZERO);
        this.update();
    }

    /**
     * Rotates around planet to the right.
     * @public
     * @param {number} angle - Rotation angle.
     * @param {boolean} [spin] - If its true rotates around globe spin.
     */
    rotateRight(angle, spin) {
        this.rotateHorizontal(-angle * math.RADIANS, spin ^ true, Vec3.ZERO);
        this.update();
    }

    /**
     * Rotates around planet to the north pole.
     * @public
     * @param {number} angle - Rotation angle.
     */
    rotateUp(angle) {
        this.rotateVertical(angle * math.RADIANS, Vec3.ZERO);
        this.update();
    }

    /**
     * Rotates around planet to the south pole.
     * @public
     * @param {number} angle - Rotation angle.
     */
    rotateDown(angle) {
        this.rotateVertical(-angle * math.RADIANS, Vec3.ZERO);
        this.update();
    }

    /**
     * Prepare camera to the frame. Used in render node frame function.
     * @public
     */
    prepareFrame() {
        if (this._flying) {
            var c = this._numFrames - this._framesCounter;

            this.planet.layerLock.lock(this._keyLock);
            this.planet.terrainLock.lock(this._keyLock);
            this.planet._normalMapCreator.lock(this._keyLock);

            this.eye = this._framesArr[c].eye;
            this._u = this._framesArr[c].u;
            this._v = this._framesArr[c].v;
            this._n = this._framesArr[c].n;
            this.update();
            this._framesCounter--;

            if (this._framesCounter < 0) {
                this.stopFlying();
                if (this._completeCallback) {
                    this._completeCallback();
                    this._completeCallback = null;
                }
            }
        } else {
            this._terrainAltitude = this._lonLat.height;
            if (this._lonLat.height < 1000000 && this._insideSegment) {
                this._terrainAltitude = this._insideSegment.getTerrainPoint(this.eye, this._insideSegmentPosition, this._terrainPoint);
                if (this._terrainAltitude < this.minAltitude) {
                    this.setAltitude(this.minAltitude);
                }
            }
        }
    }
};

export { PlanetCamera };