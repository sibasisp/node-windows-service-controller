using System;
using System.Collections.Generic;
using System.ServiceProcess;
using System.Threading;

namespace Service
{
    public enum State
    {
        Stopped,
        Running
    }

    public class ServiceManager
    {
        private readonly List<ServiceController> _services = new List<ServiceController>();

        public IEnumerable<ServiceController> Services { get { return _services; } }

        public static ServiceManager Create() { return new ServiceManager(); }

        public void AddService(Action<Service> initialize) 
        {
            var serviceContext = new Service();
            initialize(serviceContext);
            _services.Add(new ServiceController(serviceContext));
        }

        public void RunServices()
        {
            _services.ForEach(x => x.Run());
        }
    }

    public class ServiceController : ServiceBase
    {
        private readonly Service _service;
        private State _state = State.Stopped;

        public ServiceController(Service service)
        {
            _service = service;
            AutoLog = false;
            CanStop = true;
            CanShutdown = false;
            CanPauseAndContinue = true;
            CanHandleSessionChangeEvent = false;
            CanHandlePowerEvent = false;
        }

        public void Run()
        {
            ServiceName = _service.Name;
            Run(this);
        }

        public State State { get { return _state; } }
        public Service Service { get { return _service; } }

        protected override void OnStart(string[] args)
        {
            _state = State.Running;
            _service.Start();
        }

        protected override void OnStop()
        {
            _service.Stop();
            _state = State.Stopped;
        }

        protected override void OnContinue()
        {
            _state = State.Running;
            _service.Start();
        }

        protected override void OnPause()
        {
            _service.Stop();
            _state = State.Stopped;
        }
    }

    public class Service
    {
        private Lazy<object> _service;
        private Action<object> _start;
        private Action<object> _stop;

        public string Name { get; private set; }

        public void Named(string name) { Name = name; }

        public void HowToBuildService<T>(Func<string, T> build)
        {
            _service = new Lazy<object>(() => build(Name));
        }

        public void WhenStarted<T>(Action<T> start)
        {
            _start = x => start(((T)x));
        }

        public void WhenStopped<T>(Action<T> stop)
        {
            _stop = x => stop(((T)x));
        }

        public void Start()
        {
            _start(_service.Value);
        }

        public void Stop()
        {
            _stop(_service.Value);
        }
    }

    public class ServiceTimer
    {
        public enum TimerElapseStartMode
        {
            Immediate,
            AfterInterval
        }

        public enum TimerElapseReentranceMode
        {
            Reentrant,
            NonReentrant
        }

        public delegate void ElapsedEventHandler(object sender, ElapsedEventArgs e);
        public event ElapsedEventHandler Elapsed;

        private readonly System.Timers.Timer _timer;
        private int _executing;

        public ServiceTimer(double interval) :
            this(
            interval,
            TimerElapseStartMode.AfterInterval,
            TimerElapseReentranceMode.Reentrant) { }

        public ServiceTimer(
            double interval,
            TimerElapseStartMode startMode,
            TimerElapseReentranceMode reentranceMode)
        {
            _timer = new System.Timers.Timer(interval);
            _timer.Elapsed += OnElapsed;
            ElapseStartMode = startMode;
            ElapseReentranceMode = reentranceMode;
        }

        public ServiceTimer(
            double interval,
            TimerElapseStartMode startMode,
            TimerElapseReentranceMode reentranceMode,
            Action action)
        {
            _timer = new System.Timers.Timer(interval);
            _timer.Elapsed += OnElapsed;
            ElapseStartMode = startMode;
            ElapseReentranceMode = reentranceMode;
            Elapsed += (s, e) => action();
        }

        public bool AutoReset
        {
            get { return _timer.AutoReset; }
            set { _timer.AutoReset = value; }
        }

        public bool Enabled
        {
            get { return _timer.Enabled; }
            set { _timer.Enabled = value; }
        }

        public double Interval
        {
            get { return _timer.Interval; }
            set { _timer.Interval = value; }
        }

        public TimerElapseStartMode ElapseStartMode { get; set; }
        public TimerElapseReentranceMode ElapseReentranceMode { get; set; }

        public void Start()
        {
            if (ElapseStartMode == TimerElapseStartMode.Immediate)
                ThreadPool.QueueUserWorkItem(state => Elapse(new ElapsedEventArgs()));
            Enabled = true;
        }

        public void BeginInit() { _timer.BeginInit(); }
        public void Close() { _timer.Close(); }
        public void EndInit() { _timer.EndInit(); }
        public void Stop() { Enabled = false; }

        private void OnElapsed(object sender, System.Timers.ElapsedEventArgs e)
        { Elapse(new ElapsedEventArgs(e)); }

        private void Elapse(ElapsedEventArgs args)
        {
            if (ElapseReentranceMode == TimerElapseReentranceMode.NonReentrant &&
                Interlocked.CompareExchange(ref _executing, 1, 0) == 1) return;

            if (Elapsed != null) Elapsed(this, args);

            _executing = 0;
        }

        public class ElapsedEventArgs : EventArgs
        {
            private readonly DateTime _signalTime;

            public ElapsedEventArgs() { _signalTime = DateTime.Now; }

            public ElapsedEventArgs(System.Timers.ElapsedEventArgs args)
            { _signalTime = args.SignalTime; }

            public DateTime SignalTime { get { return _signalTime; } }
        }
    }
}
