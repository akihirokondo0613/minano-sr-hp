import { Composition } from "remotion";
import defaultProps from "./default-props.json";
import { MinanoLaborCm } from "./MinanoLaborCm";
import { type AdVideoProps, AdVideoSchema } from "./schema";

const fps = 30;

export const RemotionRoot = () => {
  return (
    <Composition
      id="MinanoLaborCm15"
      component={MinanoLaborCm}
      durationInFrames={450}
      fps={fps}
      height={720}
      width={1280}
      schema={AdVideoSchema}
      defaultProps={defaultProps as AdVideoProps}
    />
  );
};
