/**
 * StatusSlot
 * Contenidor reutilitzable per a missatges transitoris (carregant, errors,
 * estats buits) que evita el "rebot" de la interfície.
 *
 * En lloc de muntar/desmuntar el missatge (cosa que desplaça el contingut),
 * aquest component:
 *   - Reserva un espai fix (`minHeight`) quan es passa, de manera que mostrar o
 *     amagar el missatge no mou la resta del layout.
 *   - Fa un fade suau d'opacitat en aparèixer/desaparèixer.
 *   - Manté el contingut muntat durant el fade-out perquè la transició es vegi.
 *
 * Props:
 *   - visible: boolean. Controla si el contingut es mostra (opacitat 1) o no (0).
 *   - minHeight: number (opcional). Alçada reservada permanent. Si s'omet, el
 *     contenidor col·lapsa quan no és visible (només fade, sense reserva).
 *   - duration: number (ms) de l'animació de fade. Per defecte 200.
 *   - style: estils addicionals per al contenidor.
 *   - children: contingut a mostrar.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

export default function StatusSlot({
  visible,
  minHeight,
  duration = 200,
  style,
  children,
}) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  // Mantenim l'últim contingut renderitzat per poder fer el fade-out.
  const [rendered, setRendered] = useState(visible ? children : null);

  // Actualitza el contingut mentre és visible (text d'error dinàmic, etc.).
  useEffect(() => {
    if (visible) {
      setRendered(children);
    }
  }, [visible, children]);

  // Anima l'opacitat quan canvia la visibilitat.
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Un cop acabat el fade-out, deixem de renderitzar el contingut.
      if (finished && !visible) {
        setRendered(null);
      }
    });
  }, [visible, duration, opacity]);

  return (
    <Animated.View
      style={[minHeight != null && { minHeight }, { opacity }, style]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {rendered}
    </Animated.View>
  );
}
