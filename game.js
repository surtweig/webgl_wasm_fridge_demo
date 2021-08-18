// Initializing graphics output
ohg.init(document.getElementById("wglframe"));
ohg.backgroundColor = [0, 0, 0.25, 1];

chars = []
for (var asciiCode = 0; asciiCode < 256; asciiCode++)
{
    chars.push(String.fromCharCode(asciiCode));
}

ohg.loadAtlas("font", "http://localhost:8000/textures/font2-modified.png", 
              ohg.generateRegularGrid(chars, 96, 128, 6, 8));

ohg.loadAtlas("testAtlas", "http://localhost:8000/textures/font2-modified.png", //"https://webglfundamentals.org/webgl/resources/f-texture.png", 
              ohg.generateSingleCellGrid("img"));

var charWidth = 6;
var charHeight = 8;
var screenWidth = 40;
var screenHeight = 20;
var screenLayer = ohg.addTextDynamicGridLayer("screen", "font", "ohg-color-cut", charWidth, charHeight, screenWidth, screenHeight);
ohg.layerSetShaderUniform(screenLayer, "u_transparentColor", [0, 0, 0, 1]);
ohg.layerSetShaderUniform(screenLayer, "u_threshold", 0.01);

function getFridgeColor(instance, index)
{
    return [instance.exports.fridge_get_palette(index*3) / 256,
            instance.exports.fridge_get_palette(index*3+1) / 256,
            instance.exports.fridge_get_palette(index*3+2) / 256];
}

async function initFridgeEnv() {
    // Loading Fridge emulator
    const response = await fetch("./fridge.wasm?v=2");
    const buffer = await response.arrayBuffer();  
    const {instance} = await WebAssembly.instantiate(buffer);

    console.log(instance.exports);

    // Initializing emulator
    instance.exports.fridge_init();

    // Loading compiled program into Fridge's RAM
    var oReq = new XMLHttpRequest();
    oReq.open("GET", "./vtextdemo.bin", true);
    oReq.responseType = "blob";

    oReq.onload = async function(oEvent) {
        var blob = oReq.response;
   
        var data = await new Response(blob).arrayBuffer();
        const ramptr = instance.exports.fridge_get_ramptr();
        console.log("ramptr =".concat(ramptr));
        const ram = new Uint8Array(instance.exports.memory.buffer, ramptr, data.byteLength);
        ram.set(new Uint8Array(data));

        console.log(data);
        console.log(ram);
        var ci = 0;
        // Starting perframe updates
        ohg.onUpdate = function (deltaTime, time)
        {
            // Executing Fridge's CPU ticks
            instance.exports.fridge_tick(1000);
            
            // Updating frame display
            for (var xi = 0; xi < screenWidth; xi++)
            {
                for (var yi = 0; yi < screenHeight; yi++)
                {
                    var c = instance.exports.fridge_read_vmem((xi+yi*screenWidth)*2);
                    var color = instance.exports.fridge_read_vmem((xi+yi*screenWidth)*2+1);
                    var bgci = Math.floor(color / 16);
                    var fgci = color - bgci*16;

                    var bgcolor = getFridgeColor(instance, bgci);
                    var fgcolor = getFridgeColor(instance, fgci);

                    ohg.layerSetQuad(screenLayer, xi+yi*screenWidth,
                         [xi*charWidth, (screenHeight-yi-1)*charHeight], [charWidth, charHeight], String.fromCharCode(c), bgcolor, fgcolor);
                }
            }
        };
    };

    oReq.send();
}

initFridgeEnv();



