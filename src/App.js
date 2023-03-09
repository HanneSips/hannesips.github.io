import React, { useState, memo } from 'react';
import * as rxjs from 'rxjs';
import { ReactP5Wrapper as Sketch } from "react-p5-wrapper";
import VisualPlayground from './components/visual_playground'
import InputSelection from './components/input_selection/input_selection'
import { Output, MemoizedOutput } from './components/output'
import { Controlled } from "react-codemirror2";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/material.css";
import "codemirror/mode/javascript/javascript";
import "codemirror/addon/hint/show-hint.css";
import "codemirror/addon/hint/show-hint";
import "codemirror/addon/hint/javascript-hint";

var inputs = {};
const obsvbls = {};
const subscriptions = {}

function App() {
  const [state, forceStateChange] = useState(0); // integer state
  const [visualWidth, updateVisualWidth] = useState(0);
  const [visualHeight, updateVisualHeight] = useState(0)
  const [selected, setSelected] = useState(null);
  const [observables, changeObservables] = useState([])
  const [observers, changeObservers] = useState([])
  const [parameters, changeParameters] = useState([])
  const [visualCode, changeVisualCode] = useState(`
  var canvas
  var test = 200
  p.setup = () => {
    canvas = start_canvas()
  };

  p.draw = () => {
  	const b_colour = test % 256
	  const c_colour = 256 - test % 256

    p.background(b_colour);
    test = test + 1;
  	p.translate(canvas.width / 2, canvas.height / 2);
	p.fill(c_colour)
	p.noStoke
    p.circle(0, 0, inputs["test"])
  };
  `);

  function removeElement(elementArray, element, changeElementArrayState) {
    const index = elementArray.indexOf(element);
    if (index > -1) {
      const newelementArray = [...elementArray];
      newelementArray.splice(index, 1);
      changeElementArrayState(newelementArray);
    }
  }

  function addElement(elementArray, newElement, changeElementArrayState) {
    const newElementArray = [...elementArray];
    newElementArray.push(newElement);
    changeElementArrayState(newElementArray);
  }

  const handleClick = (index) => {
    setSelected(index);
  };

  function stopDynamicInputs() {
    inputs = {}
    // delete observables
    for (const observable in obsvbls) {
      //observable.complete()
    };
    for (const subscription in subscriptions) {
      subscriptions[subscription].unsubscribe()
    }
  }

  function executeDynamicInputs() {
    console.log("execute obs!!!")
    // function that executes all the code of all observable and observer editors
    stopDynamicInputs()

    // Create parameters
    parameters.forEach(parameter => {
      inputs[parameter.name] = parameter.value
    })

    // Create observables
    observables.forEach(observable => {
      const obsvblFunction = new Function('rxjs', observable.code)
      obsvbls[observable.name] = obsvblFunction(rxjs)
      //code = code + " \n" + observable.code
    });


    // Create observers
    observers.forEach(observer => {
      const obsrvrFunction = new Function('obsvbls', 'inputs', observer.code)
      subscriptions[observer.name] = obsrvrFunction(obsvbls, inputs)
    });

    // Use Object.values to convert the dictionary into an array of observables
    const obsvblsList = Object.values(obsvbls);

    // Use merge to merge all the observables into a single observable
    const mergedObsvbls = rxjs.merge(...obsvblsList);
    obsvbls['mergedObservable'] = mergedObsvbls
    subscriptions["inputPassing"] = mergedObsvbls.subscribe(
      () => {
        for (const key in inputs) {
          const visualParam = parameters.find(vp => vp.name === key)
          if (visualParam) {
            visualParam.changeValue(inputs[key]);
            forceStateChange(Math.random())
          }
        }
      }
    )
  }

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'row', padding: '5px' }}>
      <Column 
        isSelected={selected === 0} 
        onClick={() => handleClick(0)} 
        content={<InputSelection 
          observables={observables} observers={observers} parameters={parameters}
          changeObservables={changeObservables} changeObservers={changeObservers}
          changeParameters={changeParameters}
          selected={selected === 0}
          addElementFunction={addElement} removeElementFunction={removeElement} 
          executeCode={executeDynamicInputs}
          state={state}
        />}
        colour='lightgray'
      />
      <Column 
        isSelected={selected === 1} 
        onClick={() => handleClick(1)} 
        content={<VisualPlayground visualCode={ visualCode } changeVisualCode={changeVisualCode}/>}
        colour='gray'
      />
      <Column 
        isSelected={selected === 2} 
        onClick={() => handleClick(2)} 
        content={<MemoizedOutput selected={selected === 2} 
        updateVisualWidth = {updateVisualWidth} updateVisualHeight = {updateVisualHeight}/>}
        colour='lightgray'
      />
      <VisualMemoize visualCode={visualCode} visualWidth = {visualWidth} visualHeight = {visualHeight}/>
    </div>
  );
};


const Column = ({ isSelected, onClick, content, colour}) => (
  <div style={{ flex: isSelected ? 8 : 1, background: colour, 
  width: "100%", height: "100%", padding: '5px' }} onClick={onClick}>
    {content}
  </div>
);


// Difficulty: I wanted the input parameters to update constantly, to be up to date with every event,
// while the output I want to run smoothly, and not rerender constantly. For that I needed to use Memo
function Visual({visualCode, visualWidth, visualHeight}) {
  const sketch = (p) => {
      function start_canvas() {
        const canvas = p.createCanvas(visualWidth, visualHeight);
        canvas.parent("output-canvas");
        return canvas
      }
      try {
        eval(visualCode)
    } catch (error) {
      console.log("error")
    }
  };
  return <div>
        <Sketch sketch={sketch} />
      </div>      
}

const VisualMemoize = memo(Visual)



export default App;