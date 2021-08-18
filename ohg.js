ohg = {};

// OHG constructor
(function()
{
    var initialized = false;
    var paused = false;
    var time = 0.0;
    var prevFrameTimestamp;
    ohg.timeScale = 1.0;
    
    // WebGL context
    var gl;

    // Layers contain Quads
    var layers = [];

    // Map of all loaded atlases by name
    var atlases = {};

    // Map of all loaded shaders by name
    var shaders = {};
    const dummyShaderFunc = function (layer) {return undefined;}    

    // Orthographic projection transform
    var viewTransform = { translation: [0.0, 0.0], rotation: 0.0, scale: [1.0, 1.0], matrix: m3.identity() };
    var viewTransformChanged = true;
    ohg.backgroundColor = [0, 0, 0, 0];

    // External frame update function
    ohg.onUpdate = function(deltaTime, timeSinceStart) {}

    ohg.init = function(canvas)
    {
        if (!initialized)
        {
            // Retrieving gl context from 'webgl' canvas element
            gl = canvas.getContext("webgl", {antialias: false});
            if (!gl)
            {
                console.error("OHG: Cannot retrieve WebGL context");
                return;        
            }
            
            initialized = true;

            // Load default shaders
            ohg.loadShader("ohg-opaque");
            ohg.loadShader("ohg-color-cut", ["u_transparentColor", "u_threshold"]);
            
            prevFrameTimestamp = performance.now();

            // Request first frame callback
            requestAnimationFrame(update);
        }
    }
    
    // Load an atlas texture by URL and assign a grid.
    // Grid is a map of rectangular cells determined by position on the atlas and a size
    ohg.loadAtlas = function(name, imageURL, grid)
    {
        if (initialized)
        {
            if (name in atlases)
            {
                console.error("OHG: Atlas '".concat(name).concat("' already exists."));
                return;        
            }
            
            var atlas = {};            
            atlas.texture = gl.createTexture();
            atlas.grid = grid;
            gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
            const level = 0;
            const internalFormat = gl.RGBA;
            const width = 1;
            const height = 1;
            const border = 0;
            const srcFormat = gl.RGBA;
            const srcType = gl.UNSIGNED_BYTE;
            const pixel = new Uint8Array([0, 0, 0, 255]);
            gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, srcFormat, srcType, pixel);
            //gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));
            loadTextureAsync(atlas.texture, imageURL);
            atlases[name] = atlas;
        }
    }
    
    // Generates a grid with a single cell that takes all the space
    ohg.generateSingleCellGrid = function(glyphName)
    {
        //return {glyphName : {"pos" : [0.0, 0.0], "size" : [1.0, 1.0]}};
        grid = {};
        grid[glyphName] = {};
        grid[glyphName].pos = [0.0, 0.0];
        grid[glyphName].size = [1.0, 1.0];
        return grid;
    }
    
    // Generates regular rectangular grid
    // Useful for pixel fonts
    ohg.generateRegularGrid = function(glyphNames, atlasWidth, atlasHeight, glyphWidth, glyphHeight)
    {
        var wCount = Math.floor(atlasWidth / glyphWidth);
        var hCount = Math.floor(atlasHeight / glyphHeight);
        var uvSize = [1.0/wCount, 1.0/hCount];
        var i = 0;
        var j = 0;
        grid = {};
        for (var index in glyphNames)
        {
            var name = glyphNames[index]; 
            grid[name] = {};
            grid[name].pos = [uvSize[0]*i, uvSize[1]*j];
            grid[name].size = uvSize;
            i++;
            if (i == wCount)
            {
                i = 0;
                j++;
            }
        }
        return grid;
    }
    
    // Loads a shader from source, allows adding custom uniform fields
    // onUseFunc is called right before a draw call
    // onInitFunc is called after adding a layer with the shader
    ohg.loadShader = function(shaderName, customUniforms = [], onInitFunc = dummyShaderFunc, onUseFunc = dummyShaderFunc)
    {
        if (initialized)
        {
            if (shaderName in shaders)
            {
                console.error("OHG: Shader '".concat(shaderName).concat("' already exists."));
                return;        
            }
            
            var shader = {};
            var vertexShaderSource = document.getElementById(shaderName.concat("-v")).text;
            var fragmentShaderSource = document.getElementById(shaderName.concat("-f")).text;
        
            // create GLSL shaders, upload the GLSL source, compile the shaders
            var vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
            var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

            // Link the two shaders into a program
            shader.program = createProgram(gl, vertexShader, fragmentShader);
            shader.onInitFunc = onInitFunc;
            shader.onUseFunc = onUseFunc;
            shader.resolutionUniform = gl.getUniformLocation(shader.program, "u_resolution");
            shader.matrixUniform = gl.getUniformLocation(shader.program, "u_matrix");
            shader.textureUniform = gl.getUniformLocation(shader.program, "u_texture");
            shader.customUniforms = {};
            for (var uni in customUniforms)
            {
                uname = customUniforms[uni];
                shader.customUniforms[uname] = gl.getUniformLocation(shader.program, uname);
            }

            shaders[shaderName] = shader;        
        }
    }

    ohg.pause = function()
    {
        paused = true;
    }

    ohg.resume = function()
    {
        if (initialized)
        {
            paused = false;
            requestAnimationFrame(update);
        }
    }
    
    ohg.viewSetTranslation = function(translation)
    {
        viewTransform.translation = translation;
        viewTransformChanged = true;
    }

    ohg.viewSetRotation = function(rotation)
    {
        viewTransform.rotation = rotation;
        viewTransformChanged = true;
    }
    
    ohg.viewSetScale = function(scale)
    {
        viewTransform.scale = scale;
        viewTransformChanged = true;
    }

    // Adds a named layer with a given atlas, shader and predefined maximum number of quads
    // Use isDynamic if you plan to change geometry, UVs, etc. in frame updates
    ohg.addLayer = function(name, atlasName, shaderName, numberOfQuads, isDynamic)
    {
        if (initialized)
        {
            var newLayer = {};
            newLayer.name = name;
            newLayer.index = layers.length;
            newLayer.shader = shaders[shaderName];
            newLayer.atlas = atlases[atlasName];
            newLayer.quads = new Array(numberOfQuads).fill().map(u => (quad()));
            newLayer.translation = [0.0, 0.0];
            newLayer.rotation = 0.0;
            newLayer.scale = [1.0, 1.0];
            newLayer.transform = m3.identity();
            newLayer.visible = true;
            newLayer.quadsChanged = true;
            newLayer.transformChanged = true;
            newLayer.dismissed = false;
            newLayer.numberOfIndices = 0;
            newLayer.drawType = isDynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
            newLayer.uniforms1f = {};
            newLayer.uniforms2f = {};
            newLayer.uniforms3f = {};
            newLayer.uniforms4f = {};
            
            newLayer.positions = new Float32Array(numberOfQuads*8);
            newLayer.positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, newLayer.positionBuffer);
            newLayer.positionAttr = gl.getAttribLocation(newLayer.shader.program, "a_position");
            
            newLayer.texCoords = new Float32Array(numberOfQuads*8);
            newLayer.texCoordsBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, newLayer.texCoordsBuffer);
            newLayer.texCoordsAttr = gl.getAttribLocation(newLayer.shader.program, "a_texcoord");
            
            newLayer.bgcolors = new Float32Array(numberOfQuads*4*3);
            newLayer.bgcolorsBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, newLayer.bgcolorsBuffer);
            newLayer.bgcolorsAttr = gl.getAttribLocation(newLayer.shader.program, "a_bgcolor");

            newLayer.fgcolors = new Float32Array(numberOfQuads*4*3);
            newLayer.fgcolorsBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, newLayer.fgcolorsBuffer);
            newLayer.fgcolorsAttr = gl.getAttribLocation(newLayer.shader.program, "a_fgcolor");

            newLayer.indices = new Uint16Array(numberOfQuads*6);
            newLayer.indicesBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, newLayer.indicesBuffer);
            
            var foundDismissed = false;
            for (var i in layers)
            {
                if (layers[i].dismissed)
                {
                    newLayer.index = layers[i].index;
                    layers[i] = newLayer;
                    foundDismissed = true;
                    break;
                }
            }
            if (!foundDismissed)
                layers.push(newLayer);
            
            newLayer.shader.onInitFunc(newLayer);
            
            return newLayer.index;
        }
    }
    
    // Adds a layer with quads corresponding to each character in the text string.
    // Works with regular grid font atlas.
    ohg.addTextLineLayer = function(name, atlasName, shaderName, text, charWidth, charHeight)
    {
        var layerIndex = ohg.addLayer(name, atlasName, shaderName, text.length, false);
        for (var ci = 0; ci < text.length; ci++)
        {
            var char = text.charAt(ci);
            ohg.layerSetQuad(layerIndex, ci, [ci*charWidth, 0.0], [charWidth, charHeight], char);
            
        }
        console.log(layers[layerIndex].quads);
        return layerIndex;
    }

    // Adds a layer with quads on a fixed width rectangular text screen.
    // Works with regular grid font atlas.
    ohg.addTextDynamicGridLayer = function(name, atlasName, shaderName, charWidth, charHeight, gridWidth, gridHeight)
    {
        var layerIndex = ohg.addLayer(name, atlasName, shaderName, gridWidth*gridHeight, true);
        for (var xi = 0; xi < gridWidth; xi++)
        {
            for (var yi = 0; yi < gridHeight; yi++)
            {
                ohg.layerSetQuad(layerIndex, xi+yi*gridWidth, [xi*charWidth, yi*charHeight], [charWidth, charHeight], 'E');
            }
        }        
        return layerIndex;
    }

    ohg.getLayerIndex = function(name)
    {
        return layers.find(function(layer) {return layer.name === name}).index;
    }
    
    // Dismissed layers will be hidden immediately and then replaced when a new layer will be added
    ohg.layerDismiss = function(layerIndex)
    {
        layers[layerIndex].visible = false;
        layers[layerIndex].dismissed = true;
    }
    
    ohg.layerSetVisible = function(layerIndex, visible)
    {
        layers[layerIndex].visible = visible;
    }
    
    ohg.layerSwap = function(layerIndexA, layerIndexB)
    {
        var layerA = layers[layerIndexA];
        layers[layerIndexA] = layers[layerIndexB];
        layers[layerIndexB] = layerA;
    }
    
    ohg.layerSetTranslation = function(layerIndex, translation)
    {
        var layer = layers[layerIndex];
        layer.translation = translation;
        layer.transformChanged = true;
    }

    ohg.layerSetRotation = function(layerIndex, rotation)
    {
        var layer = layers[layerIndex];
        layer.rotation = rotation;
        layer.transformChanged = true;
    }
    
    ohg.layerSetScale = function(layerIndex, scale)
    {
        var layer = layers[layerIndex];
        layer.scale = scale;
        layer.transformChanged = true;
    }
    
    // Sets quads vertex positions, UVs and colors
    ohg.layerSetQuad = function(layerIndex, quadIndex, quadPosition, quadSize, glyphName, bgcolor = [0,0,0], fgcolor = [1,1,1])
    {
        var layer = layers[layerIndex];
        layer.quadsChanged = true;
        var q = layer.quads[quadIndex];
        q.pos = [
            quadPosition[0],             quadPosition[1],
            quadPosition[0]+quadSize[0], quadPosition[1],
            quadPosition[0]+quadSize[0], quadPosition[1]+quadSize[1],
            quadPosition[0],             quadPosition[1]+quadSize[1]
        ];
        //console.log(layer.atlas.grid);
        var uvPosition = layer.atlas.grid[glyphName].pos;
        var uvSize = layer.atlas.grid[glyphName].size;
        q.uv = [
            uvPosition[0],           uvPosition[1]+uvSize[1],
            uvPosition[0]+uvSize[0], uvPosition[1]+uvSize[1],
            uvPosition[0]+uvSize[0], uvPosition[1],
            uvPosition[0],           uvPosition[1]
        ];
        q.bgcolors = [bgcolor[0], bgcolor[1], bgcolor[2], bgcolor[0], bgcolor[1], bgcolor[2],
                      bgcolor[0], bgcolor[1], bgcolor[2], bgcolor[0], bgcolor[1], bgcolor[2] ];
        q.fgcolors = [fgcolor[0], fgcolor[1], fgcolor[2], fgcolor[0], fgcolor[1], fgcolor[2],
                      fgcolor[0], fgcolor[1], fgcolor[2], fgcolor[0], fgcolor[1], fgcolor[2] ];
        q.visible = true;
    }

    ohg.layerSetShaderUniform = function(layerIndex, uniformName, uniformData)
    {
        if (typeof uniformData === "number")
            layers[layerIndex].uniforms1f[uniformName] = uniformData;
        else if (uniformData.length == 2)
            layers[layerIndex].uniforms2f[uniformName] = uniformData;
        else if (uniformData.length == 3)
            layers[layerIndex].uniforms3f[uniformName] = uniformData;
        else if (uniformData.length == 4)
            layers[layerIndex].uniforms4f[uniformName] = uniformData;
    }
    
    function update(timestamp)
    {
        // Time calculation
        var deltaTime = (timestamp-prevFrameTimestamp)*0.0001*ohg.timeScale;
        ohg.onUpdate(deltaTime, time);
        time += deltaTime;
        
        // Clear frame
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clearColor(ohg.backgroundColor[0], ohg.backgroundColor[1], ohg.backgroundColor[2], ohg.backgroundColor[3]);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Update view matrix
        if (viewTransformChanged)
        {            
            viewTransform.matrix = trs(viewTransform.translation[0], viewTransform.translation[1], viewTransform.rotation, viewTransform.scale[0], viewTransform.scale[1]);
            viewTransformChanged = false;
        }
        
        // Drawing layers
        layers.forEach(function(layer)
        {
            // Update buffers if changes were made
            if (layer.quadsChanged)
                buildLayerGeometry(layer);
            // Draw call
            if (layer.visible)
                renderLayer(layer);
        }
        );
        
        if (!paused)
            requestAnimationFrame(update);
    }
    
    function quad()
    {
        var q = {};
        q.pos = new Array(8).fill(0.0);
        q.uv = new Array(8).fill(0.0);
        q.bgcolors = new Array(12).fill(0.0);
        q.fgcolors = new Array(12).fill(0.0);
        q.visible = false;
        return q;
    }
    
    function trs(tx, ty, rot, sx, sy)
    {
        return m3.multiply(m3.multiply(m3.translation(tx, ty), m3.rotation(rot)), m3.scaling(sx, sy));
    }
        
    function isPowerOf2(value)
    {
        return (value & (value - 1)) == 0;
    }
    
    function loadTextureAsync(texture, imageURL)
    {
        var image = new Image();
        image.src = imageURL;
        image.crossOrigin = "";
        image.addEventListener('load', function() {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            //gl.generateMipmap(gl.TEXTURE_2D);            
            // WebGL1 has different requirements for power of 2 images
            // vs non power of 2 images so check if the image is a
            // power of 2 in both dimensions.
            if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
               // Yes, it's a power of 2. Generate mips.
               gl.generateMipmap(gl.TEXTURE_2D);
            } else {
               // No, it's not a power of 2. Turn of mips and set
               // wrapping to clamp to edge
               gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
               gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
               gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
               gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            }            
        });
    }
        
    function buildLayerGeometry(layer)
    {
        var indexCounter = 0;
        var posCounter = 0;
        var vertexCounter = 0;
        for (var quadIndex = 0; quadIndex < layer.quads.length; quadIndex++)
        {
            var q = layer.quads[quadIndex];
            if (q.visible)
            {
                layer.positions.set(q.pos, posCounter);
                layer.texCoords.set(q.uv, posCounter);
                layer.bgcolors.set(q.bgcolors, vertexCounter*3); // (r,g,b) for each vertex of each quad (kinda redundant)
                layer.fgcolors.set(q.fgcolors, vertexCounter*3);
                // quad triangles indices
                // 12
                // 03
                layer.indices.set([vertexCounter, vertexCounter+1, vertexCounter+3,
                                   vertexCounter+1, vertexCounter+2, vertexCounter+3], indexCounter);                                   
                vertexCounter += 4; // 4 vertices per quad
                posCounter += 8;    // 4x2 position buffer is an array of coordinate pairs (x,y) for each vertex
                indexCounter += 6;  // 2 triangles with 3 indices each
            }
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, layer.positions, layer.drawType);

        gl.bindBuffer(gl.ARRAY_BUFFER, layer.texCoordsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, layer.texCoords, layer.drawType);

        gl.bindBuffer(gl.ARRAY_BUFFER, layer.bgcolorsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, layer.bgcolors, layer.drawType);

        gl.bindBuffer(gl.ARRAY_BUFFER, layer.fgcolorsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, layer.fgcolors, layer.drawType);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.indicesBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, layer.indices, layer.drawType);
        layer.numberOfIndices = indexCounter;
        layer.quadsChanged = false;
    }
    
    function renderLayer(layer)
    {        
        // Load geometry data
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.positionBuffer);
        //gl.bufferData(gl.ARRAY_BUFFER, layer.positions, layer.drawType);
        gl.vertexAttribPointer(layer.positionAttr, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(layer.positionAttr);

        gl.bindBuffer(gl.ARRAY_BUFFER, layer.texCoordsBuffer);
        //gl.bufferData(gl.ARRAY_BUFFER, layer.texCoords, layer.drawType);
        gl.vertexAttribPointer(layer.texCoordsAttr, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(layer.texCoordsAttr);

        gl.bindBuffer(gl.ARRAY_BUFFER, layer.bgcolorsBuffer);
        gl.vertexAttribPointer(layer.bgcolorsAttr, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(layer.bgcolorsAttr);

        gl.bindBuffer(gl.ARRAY_BUFFER, layer.fgcolorsBuffer);
        gl.vertexAttribPointer(layer.fgcolorsAttr, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(layer.fgcolorsAttr);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.indicesBuffer);
        //gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, layer.indices, layer.drawType);
        
        // Apply shader
        gl.useProgram(layer.shader.program);

        gl.uniform2f(layer.shader.resolutionUniform, gl.canvas.width, gl.canvas.height);
        
        if (layer.transformChanged)
        {
            layer.transform = trs(layer.translation[0], layer.translation[1], layer.rotation, layer.scale[0], layer.scale[1]);
            layer.transformChanged = false;
        }        
        var totalTransform = m3.multiply(layer.transform, viewTransform.matrix);
        gl.uniformMatrix3fv(layer.shader.matrixUniform, false, totalTransform);
        
        // Apply atlas texture
        gl.uniform1i(layer.shader.textureUniform, 0);                
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, layer.atlas.texture);        
        
        for (var uname in layer.uniforms1f)
            if (uname in layer.shader.customUniforms)
                gl.uniform1f(layer.shader.customUniforms[uname], layer.uniforms1f[uname]);

        for (var uname in layer.uniforms2f)
            if (uname in layer.shader.customUniforms)
                gl.uniform2f(layer.shader.customUniforms[uname], layer.uniforms2f[uname][0], layer.uniforms2f[uname][1]);
        
        for (var uname in layer.uniforms3f)
            if (uname in layer.shader.customUniforms)
                gl.uniform3f(layer.shader.customUniforms[uname], layer.uniforms3f[uname][0], layer.uniforms3f[uname][1], layer.uniforms3f[uname][2]);
        
        for (var uname in layer.uniforms4f)
            if (uname in layer.shader.customUniforms)
                gl.uniform4f(layer.shader.customUniforms[uname], layer.uniforms4f[uname][0], layer.uniforms4f[uname][1], layer.uniforms4f[uname][2], layer.uniforms4f[uname][3]);
        
        layer.shader.onUseFunc(layer);

        // Draw call
        gl.drawElements(gl.TRIANGLES, layer.numberOfIndices, gl.UNSIGNED_SHORT, 0);
    }
    
    function createShader(gl, type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (success) {
          return shader;
        }
      
        console.log(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
      }
      
      function createProgram(gl, vertexShader, fragmentShader) {
        var program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        var success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (success) {
          return program;
        }
        console.log(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
      }
}
).call(ohg);