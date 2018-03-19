/**
 * @module og/gmx/GmxMaterial
 */

'use strict';

import { inherits } from '../../inherits.js';
import { Material } from '../../layer/Material.js';

const GmxMaterial = function (segment, layer) {

    Material.call(this, segment, layer);

    this.fromTile = null;

    this.sceneIsLoading = {};
    this.sceneExists = {};
    this.sceneIsReady = {};
    this.sceneTexture = {};
};

inherits(GmxMaterial, Material);

GmxMaterial.applySceneBitmapImage = function (id, bitmapImage) {
    this.sceneTexture[id] = this.segment.handler.createTexture(bitmapImage);
    this.sceneExists[id] = true;
    this.sceneIsReady[id] = true;
    this.sceneIsLoading[id] = false;
};


GmxMaterial.prototype.sceneNotExists = function (id) {
    this.sceneExists[id] = false;
};

export { GmxMaterial };