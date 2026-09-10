/**
 * Фильтр для преломления света (Refraction)
 * Создаёт эффект жидкого стекла с преломлением, как в liquid glass демо
 */

const fragment = `
precision mediump float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform sampler2D uNormalMap;
uniform vec2 uTexelSize;
uniform float uTime;
uniform float uRefraction;

void main(void)
{
    // Получаем нормаль из текстуры нормалей
    vec4 normalColor = texture2D(uNormalMap, vTextureCoord);
    vec2 normal = normalize(normalColor.rg * 2.0 - 1.0);
    
    // Добавляем волнообразное смещение со временем
    float waveFactor = sin(vTextureCoord.x * 10.0 + uTime) * sin(vTextureCoord.y * 10.0 + uTime * 0.7);
    normal += waveFactor * uRefraction * 0.1;
    
    // Вычисляем смещённые координаты для преломления
    vec2 refractedCoord = vTextureCoord + normal * uRefraction * uTexelSize;
    
    // Клэмпируем координаты в границы [0, 1]
    refractedCoord = clamp(refractedCoord, 0.0, 1.0);
    
    // Получаем цвет с преломлением
    vec4 refractedColor = texture2D(uSampler, refractedCoord);
    
    // Добавляем бликующий эффект (fresnel)
    float fresnel = pow(1.0 - abs(dot(normal, vec2(0.0, 1.0))), 2.0);
    vec3 bloomColor = vec3(1.0, 0.8, 0.0) * fresnel * 0.3;
    
    // Комбинируем с оригинальным цветом
    gl_FragColor = refractedColor + vec4(bloomColor, 0.0);
}
`;

export { fragment };
