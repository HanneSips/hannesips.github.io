import React, { useState, memo, useRef, useEffect } from 'react';
import * as rxjs from 'rxjs';
import { VisualPlayground } from './components/visual_playground'
import InputSelection from './components/input_selection/input_selection'
import { Output, MemoizedOutput } from './components/output'
import { Controlled } from "react-codemirror2";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/material.css";
import "codemirror/mode/javascript/javascript";
import "codemirror/addon/hint/show-hint.css";
import "codemirror/addon/hint/show-hint";
import "codemirror/addon/hint/javascript-hint";
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { Obsvable } from './components/input_selection/observable';
import { Observer } from './components/input_selection/observer';
import { VisualParameter } from './components/input_selection/visual_parameters';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';


const stopObservable$ = new Subject();
var PAR = {};
var OBS = {};
var subscriptions = {}
var GLOB = {}

function App() {
  const [run, newRun] = useState(0)
  const [upload, triggerUpload] = useState(0)
  const [showModal, setShowModal] = useState(false);
  const [zipName, setZipName] = useState('');
  const [firedObservables, newObservableFired] = useState(); // integer state
  const [visualWidth, updateVisualWidth] = useState(0);
  const [visualHeight, updateVisualHeight] = useState(0)
  const [selected, setSelected] = useState(null);
  const [topIsHovered, setTopIsHovered] = useState(false);
  const [observables, changeObservables] = useState([])
  const [observers, changeObservers] = useState([])
  const [parameters, changeParameters] = useState([])
  const [codeErrorMessage, setCodeErrorMessage] = useState('')
  const [visualCode, changeVisualCode] = useState(`
// canvasWidth and canvasHeight can be used in the code
// The dictionaries GLOB (global variables) and PAR (parameters) can be used in the code

var radius = 500

// DRAW FUNCTION: executed in loop
p5.draw = () => {
  p5.background("rgb(0,0,0)") 
  p5.circle(0, 0, radius) 
  //radius += 0.5

  //p5.circle(0, 0, PAR["radius"]) 
};
  
  `);

  const handleClick = (index) => {
    setSelected(index);
  };

  function handleMouseEnter() {
    setTopIsHovered(true);
  }

  function handleMouseLeave() {
    setTopIsHovered(false);
  }

  function stopExecution() {
    PAR = {}
    GLOB = {}
    GLOB["canvasWidth"] = visualWidth
    GLOB["canvasHeight"] = visualHeight

    // stop subscriptions
    for (const subscription in subscriptions) {
      subscriptions[subscription].unsubscribe()
    }
    subscriptions = {}


    // stop observables
    stopObservable$.next();
    stopObservable$.complete();

    OBS = {}
  }

  useEffect(() => {
    //GLOB["canvasWidth"] = visualWidth
    //GLOB["canvasHeight"] = visualHeight
    executeDynamicParams()
  }, [visualWidth, visualHeight]);

  function connectObsvblsToObsvrs() {
    observables.forEach(observable => {
      observable.observers = []
      observers.forEach(observer => {
        if (observer.code.includes(observable.name)) {
          observable.observers = [...observable.observers, observer]
        }
      })
    })
  }

  function connectObsvrsToParams() {
    observers.forEach(observer => {
      observer.parameters = []
      parameters.forEach(parameter => {
        if (observer.code.includes(parameter.name)) {
          observer.parameters = [...observer.parameters, parameter]
        }
      })
    })
  }

  function executeDynamicParams() {
    // function that executes all the code of all observable and observer editors

    // stop all existing observables / observers / parameters
    stopExecution()

    // Create parameters
    parameters.forEach(parameter => {
      PAR[parameter.name] = parameter.value
    })

    // detect and store links 
    connectObsvblsToObsvrs()
    connectObsvrsToParams()

    const defineObservable = `var observable = null`
    const returnObservable = `return observable`

    // Create observables in async way
    const observablePromises = observables.map(observable => {
      return new Promise((resolve, reject) => {
        try {
          const obsvblFunction = new Function('rxjs', 'OBS', 'PAR', 'GLOB', `return (async function () {
${defineObservable} 
${observable.code} 
${returnObservable}
          }
          )();`);
          const observableReturn = obsvblFunction(rxjs, OBS, PAR, GLOB).then((observableReturn) => {
            if (observableReturn instanceof rxjs.Observable) {
              OBS[observable.name] = observableReturn.pipe(takeUntil(stopObservable$));
              // add for each observable a subscription to higher emittedvalue number
              subscriptions[`${observable.name}_colour`] = OBS[observable.name].subscribe(() => {
                observable.emitNewValue()
              })
              observable.setErrorMessage('')

              resolve();
            } else {
              observable.setErrorMessage(`observable doesn't return observable: ${observableReturn}`);
              resolve(`observable doesn't return observable: ${observableReturn}`);
            }
          });
        } catch (error) {
          observable.setErrorMessage(error.message);
          resolve(error.message);
        }
      });
    });

    // wait until all obs returned a value (async)
    Promise.all(observablePromises).then(() => {
      createObservers()
      makeMergedObserver()
      handleStateChanges()
    }).catch((error) => {
      console.log("One or more observables failed:", error);
    });

    function createObservers() {
      const defineObserver = `var subscription = null`
      const returnObserver = `return subscription`
      // Create observers
      observers.forEach(observer => {
        try {
          const functionCode = `
${defineObserver} 
${observer.code} 
${returnObserver}; 
`
          const obsrvrFunction = new Function('OBS', 'PAR', 'GLOB', functionCode)
          subscriptions[observer.name] = obsrvrFunction(OBS, PAR, GLOB)
          observer.setErrorMessage('')
        } catch (error) {
          console.log("error!!!")
          observer.setErrorMessage(error.message)
        }
      });
    }
    console.log(GLOB)

    function makeMergedObserver() {
      /// for any observable that fires a new element, I want to reload all the parameters that changed value
      // Use Object.values to convert the dictionary into an array of observables
      const obsvblsList = Object.values(OBS);

      // Use merge to merge all the observables into a single observable
      var mergedObsvbls
      if (obsvblsList.length > 0) {
        mergedObsvbls = rxjs.merge(...obsvblsList);

        OBS['mergedObservable'] = mergedObsvbls
        subscriptions["inputPassing"] = mergedObsvbls.subscribe(
          () => {
            // Update parameter values
            for (const key in PAR) {
              const visualParam = parameters.find(vp => vp.name === key)
              const old_value = visualParam.value
              const new_value = PAR[key]
              //if (visualParam && !(new_value === old_value)) {

              visualParam.changeValue(new_value);
              //}
              //newObservableFired(Math.random());
            }
            newObservableFired(Math.random())
          }
        )
        newObservableFired(Math.random())
      }
    }

    function handleStateChanges() {
      newObservableFired(Math.random());
      newRun(Math.random)
    }
  }

  const handleClickSave = async () => {
    const zip = new JSZip();

    // Create subfolders
    const observablesFolder = zip.folder('observables');
    const observersFolder = zip.folder('observers');
    const parametersFolder = zip.folder('parameters');

    // Create empty files
    observables.forEach((observable) => {
      observablesFolder.file(`${observable.name}_${observable.id}.txt`, observable.code);
    })

    observers.forEach((observer) => {
      observersFolder.file(`${observer.name}_${observer.id}.txt`, observer.code);
    })

    parameters.forEach((parameter) => {
      parametersFolder.file(`${parameter.name}_${parameter.id}.txt`, parameter.value.toString());
    })

    zip.file('visualCode.txt', visualCode);

    // Generate the ZIP file
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // Save the ZIP file with the specified name
    saveAs(zipBlob, `${zipName || 'visual'}.zip`);

    // Close the modal
    setShowModal(false);
  };

  const handleClickUpload = () => {
    console.log("upload!")
    const input = document.createElement('input');
    //document.getElementById('fileuploadcontainer').appendChild(input);

    input.type = 'file';
    input.webkitdirectory = true;

    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (event) {
          const contents = event.target.result;
          resolve(contents);
        };
        reader.onerror = function (event) {
          reject(event.target.error);
        };
        reader.readAsText(file);
      });
    }

    input.onchange = (event) => {
      const fileList = event.target.files;
      var newObservables = [];
      var newObservers = [];
      var newParameters = [];
      const readFilePromises = Array.from(fileList).map(file => {
        const subfolder = file.webkitRelativePath.split('/')[1];
        if (subfolder === "visualCode.txt") {
          return readFile(file).then(contents => {
            const visualCode = contents;
            // set visualCode equal to txt
            changeVisualCode(visualCode);
          });
        } else if (subfolder === "observables") {
          return readFile(file).then(contents => {
            const obs_name = ("file:", file.name.split('_')[0]);
            const obs_id = ("file:", file.name.split('_')[1]);
            const obs_code = contents;
            newObservables.push(new Obsvable(0, obs_name, obs_code, obs_id));
          });
        } else if (subfolder === "observers") {
          return readFile(file).then(contents => {
            const obvr_name = ("file:", file.name.split('_')[0]);
            const obvr_id = ("file:", file.name.split('_')[0]);
            const obvr_code = contents;
            newObservers.push(new Observer(0, obvr_name, obvr_code, obvr_id));
          });
        } else if (subfolder === "parameters") {
          return readFile(file).then(contents => {
            const par_name = ("file:", file.name.split('_')[0]);
            const par_id = ("file:", file.name.split('_')[1]);
            newParameters.push(new VisualParameter(0, par_name, undefined, par_id));
          });
        }
      });

      Promise.all(readFilePromises).then(() => {
        changeObservables(newObservables);
        changeObservers(newObservers);
        changeParameters(newParameters);
      });
    };

    input.click();
    triggerUpload(Math.random())
  };


  return (
    <div>
      <div id="fileuploadcontainer" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} style={{
        minHeight: '10px'
      }} >
        {/* content of top section */}
        {
          topIsHovered && (
            <div>
              <button style={{ position: "relative", zIndex: 1, width: '50%', background: "white" }} onClick={() => setShowModal(true)}>Save Visual</button>
              <button style={{ position: "relative", zIndex: 1, width: '50%', background: "white" }} onClick={handleClickUpload}>Upload Visual</button>
            </div>
          )
        }

        {/* Modal dialog */}
        {topIsHovered && showModal && (
          <div className="modal">
            <div className="modal-content">
              <span className="close" onClick={() => setShowModal(false)}>
                &times;
              </span>
              <label htmlFor="zipName">           Enter ZIP file name...           </label>
              <input
                type="text"
                id="zipName"
                placeholder="visual"
                value={zipName}
                onChange={(e) => setZipName(e.target.value)}
              />
              <button onClick={handleClickSave}>Save ZIP</button>
            </div>
          </div>
        )}

      </div>

      <div style={{ display: 'flex', height: '100vh', flexDirection: 'row', padding: '5px' }}>
        <Column
          isSelected={selected === 0}
          onClick={() => handleClick(0)}
          content={<InputSelection
            selected={selected === 0}
            observables={observables} observers={observers} parameters={parameters}
            changeObservables={changeObservables} changeObservers={changeObservers}
            changeParameters={changeParameters}
            executeCode={executeDynamicParams}
            stopExecution={stopExecution}
            firedObservables={firedObservables}
            run={run}
            upload={upload}
          />}
          colour='lightgray'
        />
        <Column
          isSelected={selected === 1}
          onClick={() => handleClick(1)}
          content={<VisualPlayground visualCode={visualCode} changeVisualCode={changeVisualCode} codeErrorMessage={codeErrorMessage} />}
          colour='gray'
        />
        <Column
          isSelected={selected === 2}
          onClick={() => handleClick(2)}
          content={<MemoizedOutput selected={selected === 2} paramsDict={PAR} globDict={GLOB} state={firedObservables} setCodeErrorMessage={setCodeErrorMessage}
            updateVisualWidth={updateVisualWidth} updateVisualHeight={updateVisualHeight}
            visualWidth={visualWidth} visualHeight={visualHeight} visualCode={visualCode} />}
          colour='lightgray'
        />
      </div>
    </div>
  );
};


const Column = ({ isSelected, onClick, content, colour }) => (
  <div style={{
    flex: isSelected ? 8 : 1, background: colour, overflow: "hidden",
    width: "100%", height: "100%", padding: '5px'
  }} onClick={onClick}>
    {content}
  </div>
);



export default App;

// difficulty: async observable / observer functions make the sequence of executing the code more difficult